# app.py
import os
import re
import io
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
from datetime import datetime, timedelta
from PIL import Image, ImageDraw, ImageFont
from cloudinary.uploader import upload
from cloudinary.utils import cloudinary_url
import pytesseract
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
import requests
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import jwt  # PyJWT for custom token

load_dotenv()

app = Flask(__name__, static_folder='public', static_url_path='')
# Configure CORS to allow specific origins
CORS(app, resources={r"/api/*": {
    "origins": [
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "https://your-project.onrender.com"  # Replace with your Render domain
    ],
    "methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]
}})

# Configuration
MONGO_URI = os.getenv('MONGO_URI')
CLOUDINARY_CLOUD_NAME = os.getenv('CLOUDINARY_CLOUD_NAME')
CLOUDINARY_API_KEY = os.getenv('CLOUDINARY_API_KEY')
CLOUDINARY_API_SECRET = os.getenv('CLOUDINARY_API_SECRET')
PAYSTACK_SECRET_KEY = os.getenv('PAYSTACK_SECRET_KEY')
GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID')
JWT_SECRET = os.getenv('JWT_SECRET', 'your_jwt_secret_key')

# MongoDB Connection
try:
    client = MongoClient(MONGO_URI)
    db = client['resulto-ai']
    users_collection = db['users']
    results_collection = db['results']
except Exception as e:
    print(f"MongoDB connection error: {e}")
    raise

# Constants
GRADE_POINTS = {'A': 5.0, 'B+': 4.5, 'B': 4.0, 'C+': 3.5, 'C': 3.0, 'D': 2.0, 'E': 1.0, 'F': 0.0}
COURSE_CODES = ['MTH101', 'PHY101', 'CHM101', 'BIO101', 'GST101', 'ENG101', 'CSC101', 'STA101']
COURSE_TITLES = {
    'MTH101': 'Elementary Mathematics I', 'PHY101': 'General Physics I', 'CHM101': 'General Chemistry I',
    'BIO101': 'General Biology I', 'GST101': 'Communication Skills', 'ENG101': 'Introduction to Engineering',
    'CSC101': 'Introduction to Computing', 'STA101': 'Introduction to Statistics'
}

# Middleware to verify JWT
def verify_token():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, jsonify({'error': 'Unauthorized: Missing or invalid token'}), 401
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload['uid'], None, None
    except jwt.ExpiredSignatureError:
        return None, jsonify({'error': 'Token expired'}), 401
    except jwt.InvalidTokenError:
        return None, jsonify({'error': 'Invalid token'}), 401

# Routes
@app.route('/')
def serve_index():
    return send_from_directory('public', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('public', path)

@app.route('/api/auth/google', methods=['POST'])
def google_signin():
    data = request.get_json()
    id_token_string = data.get('id_token')
    if not id_token_string:
        return jsonify({'error': 'ID token required'}), 400
    try:
        # Verify Google ID token
        idinfo = id_token.verify_oauth2_token(
            id_token_string,
            google_requests.Request(),
            GOOGLE_CLIENT_ID
        )
        email = idinfo['email']
        display_name = idinfo['name']
        user_id = idinfo['sub']  # Google unique user ID

        # Check if user exists, create if not
        user = users_collection.find_one({'uid': user_id})
        if not user:
            user_data = {
                'uid': user_id,
                'email': email,
                'displayName': display_name,
                'isPremium': False,
                'createdAt': datetime.utcnow()
            }
            users_collection.insert_one(user_data)
        else:
            display_name = user.get('displayName', display_name)
            is_premium = user.get('isPremium', False)

        # Generate custom JWT
        token = jwt.encode({
            'uid': user_id,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, JWT_SECRET, algorithm='HS256')

        return jsonify({
            'uid': user_id,
            'email': email,
            'displayName': display_name,
            'isPremium': is_premium,
            'token': token
        })
    except ValueError as e:
        return jsonify({'error': f'Invalid Google token: {str(e)}'}), 401
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/api/auth/verify', methods=['GET'])
def verify():
    user_id, error, status = verify_token()
    if error:
        return error, status
    user = users_collection.find_one({'uid': user_id})
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({
        'uid': user['uid'],
        'email': user['email'],
        'displayName': user['displayName'],
        'isPremium': user.get('isPremium', False)
    })

@app.route('/api/ocr', methods=['POST'])
def ocr():
    user_id, error, status = verify_token()
    if error:
        return error, status
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400
    file = request.files['image']
    try:
        img = Image.open(file)
        text = pytesseract.image_to_string(img)
        name_match = re.search(r'Name:?\s*([A-Za-z\s]+)', text, re.I)
        reg_no_match = re.search(r'Reg\.?\s*(?:No\.?|Number):?\s*([A-Za-z0-9\/]+)', text, re.I)
        course_pattern = re.compile(r'([A-Z]{3}\d{3})[\s\w\(\)]*(A|B\+?|C\+?|D|E|F)', re.I)
        courses = []
        for match in course_pattern.finditer(text):
            code = match.group(1)
            grade = match.group(2)
            courses.append({
                'code': code,
                'title': COURSE_TITLES.get(code, 'Unknown Course'),
                'units': 3,
                'grade': grade
            })
        return jsonify({
            'studentName': name_match.group(1).strip() if name_match else '',
            'regNumber': reg_no_match.group(1).strip() if reg_no_match else '',
            'courses': courses
        })
    except Exception as e:
        return jsonify({'error': f'OCR processing failed: {str(e)}'}), 500

@app.route('/api/generate', methods=['POST'])
def generate_result():
    user_id, error, status = verify_token()
    if error:
        return error, status
    data = request.get_json()
    student_info = data.get('studentInfo')
    grades = data.get('grades')
    cgpa = data.get('cgpa')
    total_credits = data.get('totalCredits')
    is_premium = data.get('isPremium', False)

    img = Image.new('RGB', (1000, 1200), 'white')
    draw = ImageDraw.Draw(img)
    try:
        # Use DejaVuSans.ttf if available, else fall back to default
        font_path = 'fonts/DejaVuSans.ttf'
        font = ImageFont.truetype(font_path, 36) if os.path.exists(font_path) else ImageFont.load_default()
        font_small = ImageFont.truetype(font_path, 20) if os.path.exists(font_path) else ImageFont.load_default()
        font_regular = ImageFont.truetype(font_path, 16) if os.path.exists(font_path) else ImageFont.load_default()
        font_table = ImageFont.truetype(font_path, 14) if os.path.exists(font_path) else ImageFont.load_default()
        font_watermark = ImageFont.truetype(font_path, 80) if os.path.exists(font_path) else ImageFont.load_default()
    except Exception as e:
        print(f"Font loading error: {e}")
        font = ImageFont.load_default()
        font_small = ImageFont.load_default()
        font_regular = ImageFont.load_default()
        font_table = ImageFont.load_default()
        font_watermark = ImageFont.load_default()

    # Draw header
    draw.rectangle((0, 0, 1000, 120), fill='#4361ee')
    draw.text((500, 50), 'UNIVERSITY OF EXCELLENCE', fill='white', font=font, anchor='mm')
    draw.text((500, 85), 'STUDENT ACADEMIC RECORD', fill='white', font=font_small, anchor='mm')
    draw.text((500, 150), '2024/2025 ACADEMIC SESSION - FIRST SEMESTER', fill='black', font=font_small, anchor='mm')

    # Draw student info
    draw.text((50, 200), 'Student Name:', fill='black', font=font_regular)
    draw.text((50, 230), 'Registration Number:', fill='black', font=font_regular)
    draw.text((50, 260), 'Level:', fill='black', font=font_regular)
    draw.text((500, 200), 'Faculty/Department:', fill='black', font=font_regular)
    draw.text((500, 230), 'Date Issued:', fill='black', font=font_regular)
    draw.text((180, 200), student_info['name'], fill='black', font=font_regular)
    draw.text((220, 230), student_info['regNumber'], fill='black', font=font_regular)
    draw.text((110, 260), '200 Level', fill='black', font=font_regular)
    draw.text((650, 200), 'Science and Technology / Computer Science', fill='black', font=font_regular)
    draw.text((590, 230), datetime.now().strftime('%Y-%m-%d'), fill='black', font=font_regular)

    # Draw table
    draw.rectangle((50, 300, 950, 340), fill='#f0f0f0')
    draw.text((70, 325), 'S/N', fill='black', font=font_table)
    draw.text((120, 325), 'COURSE CODE', fill='black', font=font_table)
    draw.text((270, 325), 'COURSE TITLE', fill='black', font=font_table)
    draw.text((650, 325), 'UNITS', fill='black', font=font_table)
    draw.text((730, 325), 'GRADE', fill='black', font=font_table)
    draw.text((810, 325), 'GRADE POINT', fill='black', font=font_table)
    draw.line((50, 340, 950, 340), fill='#dee2e6')
    y_pos = 380
    for i, course in enumerate(grades):
        draw.text((70, y_pos), str(i + 1), fill='black', font=font_table)
        draw.text((120, y_pos), course['code'], fill='black', font=font_table)
        draw.text((270, y_pos), course['title'], fill='black', font=font_table)
        draw.text((650, y_pos), str(course['units']), fill='black', font=font_table)
        draw.text((730, y_pos), course['grade'], fill='black', font=font_table)
        draw.text((810, y_pos), str(course['units'] * GRADE_POINTS.get(course['grade'], 0)), fill='black', font=font_table)
        draw.line((50, y_pos + 15, 950, y_pos + 15), fill='#dee2e6')
        y_pos += 40

    # Draw summary
    draw.rectangle((600, 750, 950, 870), fill='#f8f9fa')
    draw.rectangle((600, 750, 950, 870), outline='#dee2e6')
    draw.text((650, 780), 'SUMMARY', fill='black', font=font_regular)
    draw.text((650, 810), 'Total Credit Units:', fill='black', font=font_table)
    draw.text((650, 840), 'CGPA:', fill='black', font=font_table)
    draw.text((900, 810), total_credits, fill='black', font=font_table, anchor='rm')
    draw.text((900, 840), cgpa, fill='black', font=font_table, anchor='rm')
    cgpa_num = float(cgpa)
    remark = ('First Class' if cgpa_num >= 4.5 else
              'Second Class Upper' if cgpa_num >= 3.5 else
              'Second Class Lower' if cgpa_num >= 2.5 else
              'Third Class' if cgpa_num >= 1.5 else 'Pass')
    draw.text((500, 920), f'Remark: {remark}', fill='#4361ee', font=font_regular, anchor='mm')
    draw.line((200, 1000, 350, 1000), fill='black')
    draw.line((650, 1000, 800, 1000), fill='black')
    draw.text((275, 1020), 'Registrar', fill='black', font=font_table, anchor='mm')
    draw.text((725, 1020), 'Dean of Faculty', fill='black', font=font_table, anchor='mm')

    # Draw watermark if not premium
    if not is_premium:
        draw.text((500, 600), 'FOR ENTERTAINMENT ONLY', fill='#ef476f', font=font_watermark, anchor='mm', angle=30)

    # Upload to Cloudinary
    try:
        img_buffer = io.BytesIO()
        img.save(img_buffer, format='PNG')
        img_buffer.seek(0)
        upload_result = upload(img_buffer, folder='results')
        image_url = upload_result['secure_url']
    except Exception as e:
        return jsonify({'error': f'Cloudinary upload failed: {str(e)}'}), 500

    # Save result
    result_data = {
        'userId': user_id,
        'studentInfo': student_info,
        'grades': grades,
        'cgpa': cgpa,
        'totalCredits': total_credits,
        'imageUrl': image_url,
        'createdAt': datetime.utcnow()
    }
    try:
        results_collection.insert_one(result_data)
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

    return jsonify({'imageUrl': image_url})

@app.route('/api/history', methods=['GET'])
def history():
    user_id, error, status = verify_token()
    if error:
        return error, status
    try:
        results = list(results_collection.find({'userId': user_id}, {'_id': 0}))
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

@app.route('/api/payment/verify', methods=['POST'])
def verify_payment():
    user_id, error, status = verify_token()
    if error:
        return error, status
    data = request.get_json()
    reference = data.get('reference')
    if not reference:
        return jsonify({'error': 'Reference required'}), 400
    try:
        response = requests.get(f'https://api.paystack.co/transaction/verify/{reference}', headers={
            'Authorization': f'Bearer {PAYSTACK_SECRET_KEY}'
        })
        if response.status_code != 200 or response.json()['data']['status'] != 'success':
            return jsonify({'error': 'Payment verification failed'}), 400
        users_collection.update_one({'uid': user_id}, {'$set': {'isPremium': True}})
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': f'Payment verification error: {str(e)}'}), 500

# Scheduled task to delete old results
def delete_old_results():
    try:
        two_weeks_ago = datetime.utcnow() - timedelta(days=14)
        results_collection.delete_many({'createdAt': {'$lt': two_weeks_ago}})
    except Exception as e:
        print(f"Error deleting old results: {e}")

# Initialize scheduler
scheduler = BackgroundScheduler()
scheduler.add_job(delete_old_results, 'interval', hours=24)
scheduler.start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
// public/script.js
const uploadInput = document.getElementById('upload');
const uploadArea = document.getElementById('upload-area');
const preview = document.getElementById('preview');
const previewSection = document.getElementById('preview-section');
const processingIndicator = document.getElementById('processing-indicator');
const editorSection = document.getElementById('editor-section');
const gradesTable = document.getElementById('grades-table');
const gradesBody = document.getElementById('grades-body');
const addCourseBtn = document.getElementById('add-course');
const generateBtn = document.getElementById('generate');
const resultModal = document.getElementById('result-modal');
const resultImage = document.getElementById('result-image');
const paymentModal = document.getElementById('payment-modal');
const upgradeButton = document.getElementById('upgrade-button');
const closeButton = document.querySelector('.close-button');
const closePaymentButton = document.querySelector('.close-payment-button');
const downloadImageBtn = document.getElementById('download-image');
const downloadPdfBtn = document.getElementById('download-pdf');
const payButton = document.getElementById('pay-button');
const emailInput = document.getElementById('email');
const studentNameInput = document.getElementById('student-name');
const regNumberInput = document.getElementById('reg-number');
const totalCreditsEl = document.getElementById('total-credits');
const cgpaEl = document.getElementById('cgpa');
const themeSwitch = document.getElementById('theme-switch');
const historySection = document.getElementById('history-section');
const historyList = document.getElementById('history-list');
const signInButton = document.getElementById('sign-in-button');

// Constants
const PAYSTACK_PUBLIC_KEY = 'pk_live_b717641a72ca4d90c9a90dc8e97dbc6cf53e00b0'; // Replace with your Paystack test public key
const GOOGLE_CLIENT_ID = '624711469515-3dd920ei05emhkni9d0v84hbbkit26cm.apps.googleusercontent.com'; // Replace with your Google Client ID
const API_BASE_URL = 'https://resulto.onrender.com/api';
const GRADE_POINTS = {
    'A': 5.0, 'B+': 4.5, 'B': 4.0, 'C+': 3.5, 'C': 3.0, 'D': 2.0, 'E': 1.0, 'F': 0.0
};
const COURSE_CODES = ['MTH101', 'PHY101', 'CHM101', 'BIO101', 'GST101', 'ENG101', 'CSC101', 'STA101'];
const COURSE_TITLES = [
    'Elementary Mathematics I', 'General Physics I', 'General Chemistry I', 'General Biology I',
    'Communication Skills', 'Introduction to Engineering', 'Introduction to Computing', 'Introduction to Statistics'
];

// Application State
let isPremiumUser = false;
let uploadedImage = null;
let resultImageUrl = null;
let darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
let accessToken = null;
let userId = null;

// Initialize the app
async function initApp() {
    setupTheme();
    setupEventListeners();
    await checkAuthState();
}

// Check authentication state
async function checkAuthState() {
    const token = localStorage.getItem('accessToken');
    if (token) {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/verify`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const user = await response.json();
                accessToken = token;
                userId = user.uid;
                isPremiumUser = user.isPremium || false;
                updateUIForSignedInUser(user);
                loadHistory();
            } else {
                signOutUser();
            }
        } catch (error) {
            console.error('Auth verification error:', error);
            signOutUser();
        }
    } else {
        updateUIForSignedOutUser();
    }
}

// Set up the theme
function setupTheme() {
    document.body.setAttribute('data-theme', darkMode ? 'dark' : 'light');
}

// Set up event listeners
function setupEventListeners() {
    uploadArea.addEventListener('click', () => uploadInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    uploadInput.addEventListener('change', handleFileUpload);
    addCourseBtn.addEventListener('click', addCourseRow);
    generateBtn.addEventListener('click', generateResult);
    upgradeButton.addEventListener('click', openPaymentModal);
    closeButton.addEventListener('click', closeResultModal);
    closePaymentButton.addEventListener('click', closePaymentModal);
    downloadImageBtn.addEventListener('click', downloadAsImage);
    downloadPdfBtn.addEventListener('click', downloadAsPDF);
    payButton.addEventListener('click', initiatePayment);
    themeSwitch.addEventListener('click', toggleTheme);
    window.addEventListener('click', (e) => {
        if (e.target === resultModal) closeResultModal();
        if (e.target === paymentModal) closePaymentModal();
    });

    // Google Sign-In
    window.handleCredentialResponse = handleCredentialResponse;
}

// Handle Google Sign-In response
async function handleCredentialResponse(response) {
    try {
        const res = await fetch(`${API_BASE_URL}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: response.credential })
        });
        const data = await res.json();
        if (data.error) {
            alert(`Sign-in failed: ${data.error}`);
        } else {
            localStorage.setItem('accessToken', data.token);
            accessToken = data.token;
            userId = data.uid;
            isPremiumUser = data.isPremium || false;
            updateUIForSignedInUser(data);
            loadHistory();
        }
    } catch (error) {
        console.error('Google Sign-In error:', error);
        alert('Sign-in failed. Please try again.');
    }
}

// Handle drag and drop
function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        uploadInput.files = e.dataTransfer.files;
        handleFileUpload({ target: uploadInput });
    }
}

// Handle file upload
async function handleFileUpload(e) {
    if (!accessToken) {
        alert('Please sign in to upload a result.');
        return;
    }
    const file = e.target.files[0];
    if (!file) return;

    processingIndicator.style.display = 'block';
    const img = new Image();
    img.onload = () => {
        preview.innerHTML = '';
        preview.appendChild(img);
        uploadedImage = img;
        previewSection.style.display = 'block';
    };
    img.src = URL.createObjectURL(file);

    const formData = new FormData();
    formData.append('image', file);
    try {
        const response = await fetch(`${API_BASE_URL}/ocr`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: formData
        });
        if (!response.ok) throw new Error('OCR processing failed');
        const data = await response.json();

        processingIndicator.style.display = 'none';
        editorSection.style.display = 'block';
        gradesBody.innerHTML = '';

        studentNameInput.value = data.studentName || '';
        regNumberInput.value = data.regNumber || '';

        if (data.courses && data.courses.length > 0) {
            data.courses.forEach(course => {
                addCourseRow(null, course.code, course.title, course.units, course.grade);
            });
        } else {
            for (let i = 0; i < 5; i++) {
                const idx = Math.floor(Math.random() * COURSE_CODES.length);
                addCourseRow(null, COURSE_CODES[idx], COURSE_TITLES[idx], randomUnits(), randomGrade());
            }
        }
        updateSummary();
    } catch (error) {
        console.error('OCR Error:', error);
        processingIndicator.style.display = 'none';
        alert('Error processing the image. Please try again.');
    }
}

// Helper functions
function findCourseTitle(code) {
    const index = COURSE_CODES.indexOf(code);
    return index !== -1 ? COURSE_TITLES[index] : 'Unknown Course';
}

function randomUnits() {
    return Math.floor(Math.random() * 4) + 1;
}

function randomGrade() {
    const grades = Object.keys(GRADE_POINTS);
    return grades[Math.floor(Math.random() * grades.length)];
}

// Add course row
function addCourseRow(e, code = '', title = '', units = 3, grade = 'A') {
    const row = document.createElement('tr');
    row.className = 'course-row';
    row.innerHTML = `
        <td><input type="text" class="course-code" value="${code}" list="course-codes" placeholder="e.g. MTH101">
            <datalist id="course-codes">${COURSE_CODES.map(c => `<option value="${c}">`).join('')}</datalist></td>
        <td><input type="text" class="course-title" value="${title}" placeholder="e.g. Calculus I"></td>
        <td><input type="number" class="course-units" value="${units}" min="1" max="6"></td>
        <td><select class="course-grade">${Object.keys(GRADE_POINTS).map(g => `<option value="${g}" ${g === grade ? 'selected' : ''}>${g}</option>`).join('')}</select></td>
        <td><button class="delete-btn" title="Remove course">✕</button></td>
    `;
    row.querySelector('.delete-btn').addEventListener('click', () => {
        row.remove();
        updateSummary();
    });
    row.querySelectorAll('input, select').forEach(input => input.addEventListener('change', updateSummary));
    gradesBody.appendChild(row);
    updateSummary();
}

// Update summary
function updateSummary() {
    const rows = document.querySelectorAll('.course-row');
    let totalUnits = 0, totalPoints = 0;
    rows.forEach(row => {
        const units = parseInt(row.querySelector('.course-units').value) || 0;
        const grade = row.querySelector('.course-grade').value;
        const points = GRADE_POINTS[grade] || 0;
        totalUnits += units;
        totalPoints += units * points;
    });
    const cgpa = totalUnits > 0 ? (totalPoints / totalUnits).toFixed(2) : '0.00';
    totalCreditsEl.textContent = totalUnits;
    cgpaEl.textContent = cgpa;
}

// Toggle theme
function toggleTheme() {
    darkMode = !darkMode;
    document.body.setAttribute('data-theme', darkMode ? 'dark' : 'light');
}

// Authentication
function updateUIForSignedInUser(user) {
    signInButton.textContent = `Sign out (${user.displayName})`;
    signInButton.onclick = signOutUser;
    uploadArea.style.display = 'block';
    editorSection.style.display = 'block';
}

function updateUIForSignedOutUser() {
    signInButton.textContent = 'Sign in with Google';
    signInButton.onclick = () => {
        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse
        });
        window.google.accounts.id.prompt();
    };
    uploadArea.style.display = 'none';
    editorSection.style.display = 'none';
    historySection.style.display = 'none';
}

function signOutUser() {
    localStorage.removeItem('accessToken');
    accessToken = null;
    userId = null;
    isPremiumUser = false;
    updateUIForSignedOutUser();
    historySection.style.display = 'none';
    window.google.accounts.id.revoke(userId, () => console.log('Google session revoked'));
}

// Generate result
async function generateResult() {
    if (!accessToken) {
        alert('Please sign in to generate a result.');
        return;
    }
    const grades = Array.from(document.querySelectorAll('.course-row')).map(row => ({
        code: row.querySelector('.course-code').value,
        title: row.querySelector('.course-title').value,
        units: parseInt(row.querySelector('.course-units').value) || 0,
        grade: row.querySelector('.course-grade').value
    }));
    const studentInfo = {
        name: studentNameInput.value || 'Student Name',
        regNumber: regNumberInput.value || 'REG12345'
    };
    try {
        const response = await fetch(`${API_BASE_URL}/generate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                studentInfo,
                grades,
                cgpa: cgpaEl.textContent,
                totalCredits: totalCreditsEl.textContent,
                isPremium: isPremiumUser
            })
        });
        if (!response.ok) throw new Error('Result generation failed');
        const data = await response.json();
        resultImageUrl = data.imageUrl;
        resultImage.src = resultImageUrl;
        openResultModal();
        loadHistory();
    } catch (error) {
        console.error('Generate Error:', error);
        alert('Error generating result. Please try again.');
    }
}

// Modals
function openResultModal() {
    resultModal.style.display = 'block';
}

function closeResultModal() {
    resultModal.style.display = 'none';
}

function openPaymentModal() {
    paymentModal.style.display = 'block';
}

function closePaymentModal() {
    paymentModal.style.display = 'none';
}

// Download functions
function downloadAsImage() {
    const link = document.createElement('a');
    link.download = `${studentNameInput.value || 'result'}_${Date.now()}.png`;
    link.href = resultImageUrl;
    link.click();
}

function downloadAsPDF() {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [1000, 1200]
    });
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
        pdf.addImage(img, 'PNG', 0, 0, 1000, 1200);
        pdf.save(`${studentNameInput.value || 'result'}_${Date.now()}.pdf`);
    };
    img.src = resultImageUrl;
}

// Initiate Paystack payment
async function initiatePayment() {
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
        alert('Please enter a valid email address');
        return;
    }
    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email,
        amount: 150000, // ₦1,500 in kobo
        currency: 'NGN',
        ref: 'REF_RESULT_' + Date.now(),
        callback: async (response) => {
            try {
                const res = await fetch(`${API_BASE_URL}/payment/verify`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ reference: response.reference })
                });
                if (res.ok) {
                    isPremiumUser = true;
                    closePaymentModal();
                    alert('Payment successful! You now have access to premium features.');
                    generateResult();
                } else {
                    alert('Payment verification failed. Please contact support.');
                }
            } catch (error) {
                console.error('Payment verification error:', error);
                alert('Error verifying payment. Please try again.');
            }
        },
        onClose: () => {
            console.log('Payment window closed');
        }
    });
    handler.openIframe();
}

// Load history
async function loadHistory() {
    if (!accessToken) return;
    try {
        const response = await fetch(`${API_BASE_URL}/history`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error('Failed to load history');
        const results = await response.json();
        historySection.style.display = 'block';
        historyList.innerHTML = results.length === 0 ? '<p>No results found.</p>' : '';
        results.forEach((result, index) => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <h4>Result ${index + 1} - ${new Date(result.createdAt).toLocaleDateString()}</h4>
                <p>Student: ${result.studentInfo.name}</p>
                <p>Reg Number: ${result.studentInfo.regNumber}</p>
                <p>CGPA: ${result.cgpa}</p>
                <img src="${result.imageUrl}" alt="Result Image" style="max-width: 200px;">
            `;
            historyList.appendChild(div);
        });
    } catch (error) {
        console.error('History Error:', error);
        historyList.innerHTML = '<p>Error loading history.</p>';
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', initApp);
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const app = express();
app.use(compression()); // Compress all responses
app.use(morgan('dev')); // Log requests for debugging
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'learnyor_secret_key_2026';

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB connection error:', err));

// Cloudinary Configuration
cloudinary.config({
  cloudinary_url: process.env.CLOUDINARY_URL
});

// Schemas
const employeeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  email: String,
  phone: String,
  designation: String,
  department: String,
  joiningDate: Date,
  salary: Number,
  address: String,
  photoUrl: String,
  status: { type: String, default: 'active' }
});

const internSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  email: String,
  phone: String,
  college: String,
  department: String,
  startDate: Date,
  endDate: Date,
  stipend: Number,
  mentor: String,
  photoUrl: String,
  status: { type: String, default: 'ongoing' },
  certificateIssued: { type: Boolean, default: false }
});

const attendanceSchema = new mongoose.Schema({
  personId: String,
  name: String,
  status: String, // present, absent, halfDay
  date: Date,
  type: String // employee, intern
});

const companySchema = new mongoose.Schema({
  name: { type: String, default: 'Learnyor CRM' },
  logoUrl: String,
  primaryColor: { type: String, default: '#2A5C82' },
  secondaryColor: { type: String, default: '#4B79A1' }
});

const Employee = mongoose.model('Employee', employeeSchema);
const Intern = mongoose.model('Intern', internSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const Company = mongoose.model('Company', companySchema);

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, default: 'Admin' }
});

const User = mongoose.model('User', userSchema);

// Middleware: Protect Routes
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      next();
    } catch (error) {
      res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Not authorized, no token' });
  }
};

// Cloudinary Storage Setup
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'learnyor_crm',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }]
  },
});
const upload = multer({ storage: storage });

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'UPDATE', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const deleteImage = async (imageUrl) => {
  if (!imageUrl) return;

  try {
    if (imageUrl.includes('cloudinary.com')) {
      // Extract public_id from Cloudinary URL
      // Example: https://res.cloudinary.com/name/image/upload/v1/folder/id.jpg
      const parts = imageUrl.split('/');
      const filename = parts.pop(); // id.jpg
      const folder = parts.pop(); // folder
      const publicId = `${folder}/${filename.split('.')[0]}`; // folder/id
      
      await cloudinary.uploader.destroy(publicId);
      console.log('Cloudinary image deleted:', publicId);
    } else if (imageUrl.startsWith('/uploads/')) {
      const filename = path.basename(imageUrl);
      const filePath = path.join(__dirname, 'uploads', filename);
      await fs.unlink(filePath);
      console.log('Local image deleted:', filename);
    }
  } catch (e) {
    console.error('Error deleting image:', e.message);
  }
};

// --- Auth Routes ---

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login attempts per window
  message: { error: 'Too many login attempts, please try again after 15 minutes' }
});

// Login
app.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' })
      });
    } else {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register (One-time use to create admin)
app.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashedPassword, name });
    
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' })
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify Token
app.get('/auth/verify', protect, (req, res) => {
  res.json(req.user);
});

// Update Profile (Name & Password)
app.put('/auth/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Update name if provided
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;

    // Password change logic
    if (req.body.newPassword) {
      // Verify old password first
      const isMatch = await bcrypt.compare(req.body.oldPassword, user.password);
      if (!isMatch) return res.status(400).json({ error: 'Incorrect current password' });

      user.password = await bcrypt.hash(req.body.newPassword, 10);
    }

    const updatedUser = await user.save();
    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      token: jwt.sign({ id: updatedUser._id }, JWT_SECRET, { expiresIn: '30d' })
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Branding Routes ---

// Get Company Info
app.get('/company', async (req, res) => {
  try {
    let company = await Company.findOne();
    if (!company) {
      company = await Company.create({ name: 'Learnyor CRM' });
    }
    res.json(company);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Company Info
app.put('/company', protect, async (req, res) => {
  try {
    let company = await Company.findOne();
    if (!company) company = new Company();

    company.name = req.body.name || company.name;
    company.logoUrl = req.body.logoUrl || company.logoUrl;
    company.primaryColor = req.body.primaryColor || company.primaryColor;
    company.secondaryColor = req.body.secondaryColor || company.secondaryColor;

    const updatedCompany = await company.save();
    res.json(updatedCompany);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Routes
app.post('/upload', protect, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  // req.file.path contains the full secure URL from Cloudinary
  const imageUrl = req.file.path; 
  res.json({ imageUrl });
});

// Employee Endpoints
app.get('/employees', protect, async (req, res) => {
  try {
    const employees = await Employee.find();
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/employees', protect, async (req, res) => {
  try {
    const employeeData = { ...req.body };
    delete employeeData._id;
    delete employeeData.__v;
    
    const employee = await Employee.findOneAndUpdate(
      { id: employeeData.id },
      employeeData,
      { upsert: true, new: true }
    );
    res.status(201).json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/employees/:id', protect, async (req, res) => {
  try {
    const employee = await Employee.findOne({ id: req.params.id });
    if (employee) await deleteImage(employee.photoUrl);
    await Employee.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Intern Endpoints
app.get('/interns', protect, async (req, res) => {
  try {
    const interns = await Intern.find();
    res.json(interns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/interns', protect, async (req, res) => {
  try {
    const internData = { ...req.body };
    delete internData._id;
    delete internData.__v;

    const intern = await Intern.findOneAndUpdate(
      { id: internData.id },
      internData,
      { upsert: true, new: true }
    );
    res.status(201).json(intern);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/interns/:id', protect, async (req, res) => {
  try {
    const intern = await Intern.findOne({ id: req.params.id });
    if (intern) await deleteImage(intern.photoUrl);
    await Intern.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Attendance Endpoints
app.get('/attendance', protect, async (req, res) => {
  try {
    const records = await Attendance.find();
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/attendance', protect, async (req, res) => {
  try {
    const record = req.body;
    const dateOnly = new Date(record.date);
    dateOnly.setHours(0, 0, 0, 0);
    
    const nextDay = new Date(dateOnly);
    nextDay.setDate(nextDay.getDate() + 1);

    const updatedRecord = await Attendance.findOneAndUpdate(
      { 
        personId: record.personId,
        date: { $gte: dateOnly, $lt: nextDay }
      },
      record,
      { upsert: true, new: true }
    );
    res.status(201).json(updatedRecord);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- System Recovery ---
app.post('/system/restore', protect, async (req, res) => {
  const { employees, interns, attendance } = req.body;
  
  try {
    // 1. Clear existing data (CAUTION: Production wipe)
    await Employee.deleteMany({});
    await Intern.deleteMany({});
    await Attendance.deleteMany({});

    // 2. Insert backup data
    if (employees) await Employee.insertMany(employees);
    if (interns) await Intern.insertMany(interns);
    if (attendance) await Attendance.insertMany(attendance);

    res.json({ success: true, message: 'System restored successfully from backup' });
  } catch (err) {
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Learnyor Backend running at http://localhost:${PORT}`);
});

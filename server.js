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

const PORT = process.env.PORT || 5000;
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
  name: { type: String, default: 'Admin' },
  role: { type: String, default: 'employee' }
});

const User = mongoose.model('User', userSchema);

const reportSchema = new mongoose.Schema({
  id: String,
  staffId: String,
  staffName: String,
  date: Date,
  description: String,
  tasks: [String],
  hoursWorked: Number,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

const Report = mongoose.model('Report', reportSchema);

const leaveRequestSchema = new mongoose.Schema({
  id: String,
  staffId: String,
  staffName: String,
  startDate: Date,
  endDate: Date,
  reason: String,
  type: { type: String, enum: ['fullDay', 'halfDay'], default: 'fullDay' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);

const notificationSchema = new mongoose.Schema({
  recipientEmail: { type: String, required: true }, // 'admin' or specific staff email
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['leave', 'report', 'system'], default: 'system' },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);

const createNotification = async (recipient, title, message, type) => {
  try {
    await Notification.create({ recipientEmail: recipient, title, message, type });
    console.log(`🔔 Signal Generated: [${type}] for ${recipient}`);
  } catch (err) {
    console.error('❌ Failed to generate signal:', err);
  }
};

// Middleware: Protect Routes
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return res.status(401).json({ error: 'User no longer exists' });
      }
      
      // Super-Admin Overrule: Guarantee administrative power for the primary email
      if (user.email === 'jafarevx123@gmail.com') {
        user.role = 'admin';
      }
      
      req.user = user;
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
  max: 50, // Increased limit for improved flexibility
  message: { error: 'Too many login attempts, please try again after 15 minutes' }
});

// Login
app.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user && (await bcrypt.compare(password, user.password))) {
      // Super-Admin Overrule
      const finalRole = user.email === 'jafarevx123@gmail.com' ? 'admin' : user.role;
      
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: finalRole, 
        token: jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' })
      });
    } else {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register (Auto-provisions professional profile)
app.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password, name, role } = req.body;
  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashedPassword, name, role: role || 'employee' });
    
    // Authoritative Profile Generation
    const profileId = `ID-${Date.now()}`;
    if (user.role === 'intern') {
      await Intern.create({ id: profileId, name: user.name, email: user.email, status: 'ongoing' });
      console.log(`Auto-Created Intern Profile for: ${user.email}`);
    } else {
      await Employee.create({ id: profileId, name: user.name, email: user.email, designation: 'Staff', status: 'active' });
      console.log(`Auto-Created Employee Profile for: ${user.email}`);
    }
    
    // Super-Admin Overrule
    const finalRole = user.email === 'jafarevx123@gmail.com' ? 'admin' : user.role;
    
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: finalRole,
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

// Get all users (Admin only)
app.get('/auth/users', protect, async (req, res) => {
  try {
    // Only allow authorized administrator access
    if (!req.user.role || req.user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Administrative access required' });
    }
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// Employee Endpoints (Retrieval & Deletion handled here, POST handled in Provisioning section below)
app.get('/employees', protect, async (req, res) => {
  try {
    const employees = await Employee.find();
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    let query = {};
    const isAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    
    if (!isAdmin) {
      // Find the professional ID for this user
      const emp = await Employee.findOne({ email: req.user.email });
      const intern = await Intern.findOne({ email: req.user.email });
      const personId = emp ? emp.id : (intern ? intern.id : 'NONE');
      query = { personId };
    }

    const records = await Attendance.find(query);
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

// Admin User Management: Update Role
app.put('/auth/users/:email/role', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.role = req.body.role;
    await user.save();
    res.json({ success: true, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper for Auto-Identity
async function provisionUser(data, role) {
  const userExists = await User.findOne({ email: data.email });
  if (!userExists) {
    const hashedPassword = await bcrypt.hash('Learn@2026', 10);
    await User.create({
      email: data.email,
      password: hashedPassword,
      name: data.name,
      role: role
    });
    console.log(`Auto-Provisioned User: ${data.email} as ${role}`);
  }
}

// Updated Handlers
app.post('/employees', protect, async (req, res) => {
  try {
    const employeeData = { ...req.body };
    delete employeeData._id;
    
    const employee = await Employee.findOneAndUpdate(
      { id: employeeData.id },
      employeeData,
      { upsert: true, new: true }
    );
    
    // Auto-Provision Identity
    await provisionUser(employeeData, 'employee');
    
    res.status(201).json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/interns', protect, async (req, res) => {
  try {
    const internData = { ...req.body };
    delete internData._id;

    const intern = await Intern.findOneAndUpdate(
      { id: internData.id },
      internData,
      { upsert: true, new: true }
    );
    
    // Auto-Provision Identity
    await provisionUser(internData, 'intern');
    
    res.status(201).json(intern);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- REPORTS ENDPOINTS ---
app.get('/api/reports', protect, async (req, res) => {
  try {
    let query = {};
    
    // Privacy Logic: Only admins see everything. Staff/Interns see their own reports.
    const isMainAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    if (!isMainAdmin) {
      query = { staffId: req.user.email };
    }

    const reports = await Report.find(query).sort({ date: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/reports', protect, async (req, res) => {
  try {
    const reportData = { ...req.body };
    // Enforce current user identity for security
    const isMainAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    if (!isMainAdmin) {
      reportData.staffId = req.user.email;
      reportData.staffName = req.user.name;
    }
    
    const report = new Report(reportData);
    const newReport = await report.save();
    
    // Notify Admin
    await createNotification('admin', 'New Work Log', `${reportData.staffName} submitted a new report`, 'report');
    
    res.status(201).json(newReport);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/reports/:id', protect, async (req, res) => {
  try {
    const updatedReport = await Report.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
    
    // Notify Staff if status was updated
    if (req.body.status) {
      await createNotification(
        updatedReport.staffId, 
        `Report ${req.body.status.toUpperCase()}`, 
        `Your work log for ${new Date(updatedReport.date).toLocaleDateString()} has been ${req.body.status}`, 
        'report'
      );
    }
    
    res.json(updatedReport);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// --- LEAVE REQUESTS ENDPOINTS ---
app.get('/api/leaves', protect, async (req, res) => {
  try {
    let query = {};
    const isAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    if (!isAdmin) {
      query = { staffId: req.user.email };
    }
    const leaves = await LeaveRequest.find(query).sort({ startDate: -1 });
    res.json(leaves);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/leaves', protect, async (req, res) => {
  try {
    const leaveData = { ...req.body };
    const isAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    if (!isAdmin) {
      leaveData.staffId = req.user.email;
      leaveData.staffName = req.user.name;
    }
    const leave = new LeaveRequest(leaveData);
    const newLeave = await leave.save();
    
    // Notify Admin
    await createNotification('admin', 'New Leave Request', `${leaveData.staffName} requested leave for ${new Date(leaveData.startDate).toLocaleDateString()}`, 'leave');
    
    res.status(201).json(newLeave);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/leaves/:id', protect, async (req, res) => {
  try {
    // Only admins can update status
    if (req.body.status && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Administrative access required to update status' });
    }
    const updatedLeave = await LeaveRequest.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
    
    // Notify Staff
    if (req.body.status) {
      await createNotification(
        updatedLeave.staffId,
        `Leave Request ${req.body.status.toUpperCase()}`,
        `Your leave request starting ${new Date(updatedLeave.startDate).toLocaleDateString()} has been ${req.body.status}`,
        'leave'
      );
    }
    
    res.json(updatedLeave);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// --- NOTIFICATIONS ENDPOINTS ---
app.get('/api/notifications', protect, async (req, res) => {
  try {
    const isAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    const recipient = isAdmin ? 'admin' : req.user.email;
    
    const notifications = await Notification.find({ recipientEmail: recipient })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/notifications/:id/read', protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/notifications/read-all', protect, async (req, res) => {
  try {
    const isAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    const recipient = isAdmin ? 'admin' : req.user.email;
    
    await Notification.updateMany({ recipientEmail: recipient }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
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

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB connection error:', err));

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

const Employee = mongoose.model('Employee', employeeSchema);
const Intern = mongoose.model('Intern', internSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

// File Upload Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
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
  if (imageUrl && imageUrl.startsWith('/uploads/')) {
    const filename = path.basename(imageUrl);
    const filePath = path.join(__dirname, 'uploads', filename);
    try {
      await fs.unlink(filePath);
    } catch (e) {
      console.error('Error deleting image:', e.message);
    }
  }
};

// Routes
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

// Employee Endpoints
app.get('/employees', async (req, res) => {
  try {
    const employees = await Employee.find();
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/employees', async (req, res) => {
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

app.delete('/employees/:id', async (req, res) => {
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
app.get('/interns', async (req, res) => {
  try {
    const interns = await Intern.find();
    res.json(interns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/interns', async (req, res) => {
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

app.delete('/interns/:id', async (req, res) => {
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
app.get('/attendance', async (req, res) => {
  try {
    const records = await Attendance.find();
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/attendance', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Learnyor Backend running at http://localhost:${PORT}`);
});

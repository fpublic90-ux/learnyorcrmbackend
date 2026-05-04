require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

// Schemas (must match server.js)
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
  status: String,
  date: Date,
  type: String
});

const Employee = mongoose.model('Employee', employeeSchema);
const Intern = mongoose.model('Intern', internSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

async function migrate() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!');

    const content = await fs.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(content);

    if (data.employees && data.employees.length > 0) {
      console.log(`Migrating ${data.employees.length} employees...`);
      for (const emp of data.employees) {
        await Employee.findOneAndUpdate({ id: emp.id }, emp, { upsert: true });
      }
    }

    if (data.interns && data.interns.length > 0) {
      console.log(`Migrating ${data.interns.length} interns...`);
      for (const int of data.interns) {
        await Intern.findOneAndUpdate({ id: int.id }, int, { upsert: true });
      }
    }

    if (data.attendance && data.attendance.length > 0) {
      console.log(`Migrating ${data.attendance.length} attendance records...`);
      for (const att of data.attendance) {
        // Find existing record for same person and date
        const dateOnly = new Date(att.date);
        dateOnly.setHours(0, 0, 0, 0);
        const nextDay = new Date(dateOnly);
        nextDay.setDate(nextDay.getDate() + 1);

        await Attendance.findOneAndUpdate(
          { 
            personId: att.personId,
            date: { $gte: dateOnly, $lt: nextDay }
          },
          att,
          { upsert: true }
        );
      }
    }

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.connection.close();
  }
}

migrate();

const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const schools = require('../utils/schools');

test('student accounts accept a listed school', () => {
  for (const school of schools) {
    const user = new User({
      name: 'Test Student',
      studentId: `student-${school}`,
      school,
      email: `${school.toLowerCase()}@example.edu`,
      passwordHash: 'hashed-password',
      role: 'student'
    });

    assert.equal(user.validateSync(), undefined);
  }
});

test('student accounts reject an unlisted school', () => {
  const user = new User({
    name: 'Test Student',
    studentId: 'student-invalid',
    school: 'INVALID',
    email: 'invalid@example.edu',
    passwordHash: 'hashed-password',
    role: 'student'
  });

  assert.equal(user.validateSync().errors.school.kind, 'enum');
});

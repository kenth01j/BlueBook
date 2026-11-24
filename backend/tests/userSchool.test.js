const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const schools = require('../utils/schools');
const { isAvailableSchool } = require('../services/schoolSettings');

test('default school choices include SOE and can be selected', () => {
  assert.ok(schools.includes('SOE'));
  for (const school of schools) {
    assert.equal(isAvailableSchool(school, schools), true);
  }
});

test('retired school assignments remain valid historical user data but are no longer selectable', () => {
  const user = new User({
    name: 'Test Student',
    studentId: 'student-retired',
    school: 'RETIRED',
    email: 'retired@example.edu',
    passwordHash: 'hashed-password',
    role: 'student'
  });

  assert.equal(user.validateSync(), undefined);
  assert.equal(isAvailableSchool(user.school, schools), false);
});

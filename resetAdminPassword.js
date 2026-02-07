const bcrypt = require('bcrypt');
const pool = require('./src/db/connection');

async function resetAdminPassword() {
  try {
    const email = 'cecogbill@gmail.com';
    const password = 'password123';

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update password
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, role = $2 WHERE email = $3 RETURNING email, username, role',
      [passwordHash, 'admin', email]
    );

    if (result.rows.length > 0) {
      console.log('✓ Admin password reset successfully');
      console.log('  Email:', result.rows[0].email);
      console.log('  Username:', result.rows[0].username);
      console.log('  Role:', result.rows[0].role);
      console.log('  Password: password123');
    } else {
      console.log('✗ Admin user not found');
    }

    await pool.end();
  } catch (error) {
    console.error('Error resetting admin password:', error);
    process.exit(1);
  }
}

resetAdminPassword();

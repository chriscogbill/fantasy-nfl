const bcrypt = require('bcrypt');
const pool = require('./src/db/connection');

async function createAdminUser() {
  try {
    const email = 'cecogbill@gmail.com';
    const username = 'cecogbill';
    const password = 'password123'; // Change this to a secure password
    const fullName = 'Chris Cogbill';
    const role = 'admin';

    // Check if user already exists
    const existing = await pool.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      console.log('Admin user already exists. Updating role...');
      await pool.query(
        'UPDATE users SET role = $1 WHERE email = $2',
        [role, email]
      );
      console.log('✓ Admin role updated for', email);
    } else {
      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create admin user
      await pool.query(
        `INSERT INTO users (email, username, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [email, username, passwordHash, fullName, role]
      );

      console.log('✓ Admin user created:', email);
      console.log('  Username:', username);
      console.log('  Password:', password);
    }

    await pool.end();
  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  }
}

createAdminUser();

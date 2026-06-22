function normalizePhone(phone) {
  return typeof phone === 'string' ? phone.trim() : ''
}

function rowToUser(row) {
  if (!row) return null
  return {
    id: row.id,
    phone: row.phone,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  }
}

function withUserOperations(BaseClass) {
  return class extends BaseClass {
    createUser({ phone, passwordHash, passwordSalt }) {
      if (!this.ensureDb()) return null
      const now = Date.now()
      const result = this.db.prepare(`
        INSERT INTO users (phone, password_hash, password_salt, created_at, last_login_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(normalizePhone(phone), passwordHash, passwordSalt, now, now)
      return this.getUserById(result.lastInsertRowid)
    }

    getUserById(userId) {
      if (!this.ensureDb()) return null
      return rowToUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId))
    }

    getUserByPhone(phone) {
      if (!this.ensureDb()) return null
      return rowToUser(this.db.prepare('SELECT * FROM users WHERE phone = ?').get(normalizePhone(phone)))
    }

    touchUserLogin(userId) {
      if (!this.ensureDb()) return null
      this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), userId)
      return this.getUserById(userId)
    }
  }
}

module.exports = { withUserOperations }

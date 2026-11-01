CREATE TABLE IF NOT EXISTS material (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          create_time DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours')),
          card TEXT NOT NULL,
          month TEXT NOT NULL,
          year TEXT NOT NULL,
          cvv TEXT,
          name TEXT,
          address TEXT,
          city TEXT,
          state TEXT,
          zip TEXT,
          country TEXT,
          extra TEXT,
          amount INTEGER DEFAULT 0,
          status INTEGER DEFAULT 0,
          device TEXT,
          note TEXT
        );

CREATE TABLE IF NOT EXISTS device (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          create_time DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours')),
          symbol TEXT NOT NULL,
          account TEXT,
          amount REAL,
          count INTEGER NOT NULL DEFAULT 0,
          status INTEGER NOT NULL DEFAULT 1,
          note TEXT
        );

CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          create_time DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours')),
          card TEXT NOT NULL,
          month TEXT,
          day TEXT,
          cvv TEXT,
          year TEXT,
          extra TEXT,
          amount INTEGER DEFAULT 0,
          status INTEGER DEFAULT 3,
          device TEXT,
          note TEXT
        );

CREATE TABLE IF NOT EXISTS config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          value TEXT,
          create_time DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours'))
        );

const { v4: uuidV4 } = require('uuid');
const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: ['https://todomytaskapp.netlify.app', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'User-ID'],
    credentials: true,
}));

app.use(express.json());

// Determine database paths based on environment
const getDatabasePath = (dbName) => {
    if (process.env.VERCEL_ENV) {
        return path.join('/tmp', dbName); // Vercel environment
    }
    return path.join(__dirname, dbName); // Local development environment
};

const databasePathUsers = getDatabasePath('users.db');
let usersDatabase = null;

const initializeDbAndServerUsers = async () => {
    try {
        usersDatabase = await open({
            filename: databasePathUsers,
            driver: sqlite3.Database,
        });

        await usersDatabase.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                name TEXT
            )
        `);

        console.log('Users Database Connected');
    } catch (error) {
        console.error(`Users DB Error: ${error.message}`);
        process.exit(1);
    }
};

const initializeDbForUser = async (userId) => {
    const userDbPath = getDatabasePath(`todos_${userId}.db`);
    try {
        const userDatabase = await open({
            filename: userDbPath,
            driver: sqlite3.Database,
        });

        await userDatabase.run(`
            CREATE TABLE IF NOT EXISTS todo (
                id TEXT PRIMARY KEY,
                text TEXT,
                priority TEXT,
                status TEXT
            )
        `);

        return userDatabase;
    } catch (error) {
        console.error(`User DB Error: ${error.message}`);
        throw new Error(`User DB Error: ${error.message}`);
    }
};

const setUserDatabase = async (req, res, next) => {
    const userId = req.headers['user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID is required' });

    try {
        req.userDatabase = await initializeDbForUser(userId);
        next();
    } catch (error) {
        res.status(500).json({ error: `Error initializing user database: ${error.message}` });
    }
};

const initialize = async () => {
    await initializeDbAndServerUsers();
    app.listen(5000, () =>
        console.log('Server Running at http://localhost:5000/')
    );
};

initialize();

app.post('/register', async (req, res) => {
    const { username, password, name } = req.body;
    console.log('Register Request:', req.body);
    const hashedPassword = password;

    try {
        await usersDatabase.run(
            `INSERT INTO users (username, password, name) VALUES (?, ?, ?)`,
            username, hashedPassword, name
        );
        res.status(201).json({ message: 'User Registered Successfully' });
    } catch (error) {
        console.error(`Register Error: ${error.message}`);
        res.status(400).json({ error: error.message });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await usersDatabase.get(
            `SELECT * FROM users WHERE username = ?`,
            username
        );

        if (user && password === user.password) {
            res.json({ userId: user.id, name: user.name });
        } else {
            res.status(400).json({ error: 'Invalid Credentials' });
        }
    } catch (error) {
        console.error(`Login Error: ${error.message}`);
        res.status(400).json({ error: error.message });
    }
});

app.use('/todos', setUserDatabase);

app.post('/todos', async (req, res) => {
    const { text, priority, status } = req.body;
    const id = uuidV4();

    const addTodoQuery = `
        INSERT INTO todo (id, text, priority, status)
        VALUES (?, ?, ?, ?);`;

    try {
        await req.userDatabase.run(addTodoQuery, [id, text, priority, status]);
        res.status(201).json({ id, text, priority, status });
    } catch (error) {
        console.error(`Add Todo Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/todos', async (req, res) => {
    const { search_q = '', priority, status } = req.query;
    let getTodosQuery = `
        SELECT * FROM todo
        WHERE text LIKE ?`;

    const queryParams = [`%${search_q}%`];

    if (priority !== undefined) {
        getTodosQuery += ` AND priority = ?`;
        queryParams.push(priority);
    }

    if (status !== undefined) {
        getTodosQuery += ` AND status = ?`;
        queryParams.push(status);
    }

    try {
        const data = await req.userDatabase.all(getTodosQuery, queryParams);
        res.json(data);
    } catch (error) {
        console.error(`Get Todos Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/todos/:todoId', async (req, res) => {
    const { todoId } = req.params;
    const getTodoQuery = `
        SELECT * FROM todo
        WHERE id = ?;`;
    try {
        const todo = await req.userDatabase.get(getTodoQuery, todoId);
        res.json(todo);
    } catch (error) {
        console.error(`Get Todo Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.put('/todos/:todoId', async (req, res) => {
    const { todoId } = req.params;
    const { text, priority, status } = req.body;

    const previousTodoQuery = `
        SELECT * FROM todo
        WHERE id = ?;`;

    try {
        const previousTodo = await req.userDatabase.get(previousTodoQuery, todoId);

        if (!previousTodo) {
            return res.status(404).json({ error: 'Todo not found' });
        }

        const updatedText = text !== undefined ? text : previousTodo.text;
        const updatedPriority = priority !== undefined ? priority : previousTodo.priority;
        const updatedStatus = status !== undefined ? status : previousTodo.status;

        const updateTodoQuery = `
            UPDATE todo
            SET text = ?, priority = ?, status = ?
            WHERE id = ?;`;

        await req.userDatabase.run(updateTodoQuery, [updatedText, updatedPriority, updatedStatus, todoId]);

        res.json({ message: 'Todo Updated' });
    } catch (error) {
        console.error(`Update Todo Error: ${error.message}`);
        res.status(500).json({ error: 'Failed to update todo: ' + error.message });
    }
});

app.delete('/todos/:todoId', async (req, res) => {
    const { todoId } = req.params;
    const deleteTodoQuery = `
        DELETE FROM todo
        WHERE id = ?;`;

    try {
        await req.userDatabase.run(deleteTodoQuery, todoId);
        res.json({ message: 'Todo Deleted' });
    } catch (error) {
        console.error(`Delete Todo Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

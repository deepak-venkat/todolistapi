const express = require('express')
const path = require('path')
const jwt = require('jsonwebtoken')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcryptjs')
const app = express()
app.use(express.json())

const cors = require('cors');
app.use(cors({                          //app.use(cors()) enables all origins
  origin: 'https://dvatodolist.netlify.app',
  credentials: true,
}));

require('dotenv').config();
const dbPath = process.env.DATABASE_URL || path.join(__dirname, 'todo.db');

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(process.env.PORT, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

app.post("/register", async (request, response) => {
    const { username, password} = request.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const selectUserQuery = `SELECT * FROM users WHERE username = '${username}'`;
    const dbUser = await db.get(selectUserQuery);
    if (dbUser === undefined) {
      const createUserQuery = `
        INSERT INTO 
          users (username, password) 
        VALUES 
          (
            '${username}', 
            '${hashedPassword}'
          )`;
      const dbResponse = await db.run(createUserQuery);
      const newUserId = dbResponse.lastID;
      response.send(`Created new user with ${newUserId}`);
    } else {
      response.status = 400;
      response.send("User already exists");
    }
  });

app.post("/login", async (request, response) => {
    const { username, password } = request.body;
    const selectUserQuery = `SELECT * FROM users WHERE username = '${username}'`;
    const dbUser = await db.get(selectUserQuery);
    if (dbUser === undefined) {
      response.status(400);
      response.send("Invalid User");
    } else {
      const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
      if (isPasswordMatched === true) {
        const payload = {
            user_id: dbUser.id,
            username
        }
        const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, {expiresIn: '7d'});
        const createSessionQuery = `
          INSERT INTO sessions (user_id) 
          VALUES (${dbUser.id})`;
        await db.run(createSessionQuery);
        response.send({jwtToken});
      } else {
        response.status(400);
        response.send("Invalid Password");
      }
    }
  });


const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    let token = null
    if(authHeader && authHeader.startsWith('Bearer '))
        token = authHeader.split(' ')[1];
    else
        return res.sendStatus(401); 
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); 
        req.user = user; //storing decoded jwt payload in req
        next();
});
};

const hasStatusProperty = (requestQuery) => {
    return requestQuery.status !== undefined;
  };
  
const hasSearchProperty = (requestQuery) => {
    return requestQuery.search_q !== undefined;
  };
  
const outPutResult = (dbObject) => {
    return {
      id: dbObject.id,
      userId: dbObject.user_id,
      description: dbObject.description,
      status: dbObject.status,
    };
  };

app.get("/todos/", authenticateToken, async (request, response) => {
  let data = null;
  let getTodosQuery = "";
  const { search_q = "", status } = request.query;

  switch (true) {
    case hasStatusProperty(request.query):
        if (status === "TO DO" || status === "DONE") {
            getTodosQuery = `SELECT * FROM todo_items WHERE status = '${status}';`;
            data = await db.all(getTodosQuery);
            response.send(data.map((eachItem) => outPutResult(eachItem)));
        } else {
            response.status(400);
            response.send("Invalid Todo Status");
        }
        break;
    case hasSearchProperty(request.query):
        getTodosQuery = `SELECT * FROM todo_items WHERE description LIKE '%${search_q}%';`;
        data = await db.all(getTodosQuery);
        response.send(data.map((eachItem) => outPutResult(eachItem)));
        break;
    default:
        getTodosQuery = `SELECT * FROM todo_items;`;
        data = await db.all(getTodosQuery);
        response.send(data.map((eachItem) => outPutResult(eachItem)));
}
});

app.post('/todos/', authenticateToken, async (request, response) => {
const { user_id, description, status } = request.body;
if (status === 'TO DO' || status === 'DONE') {
    const postTodoQuery = `
    INSERT INTO todo_items (user_id, description, status)
    VALUES ('${user_id}', '${description}', '${status}');`;
    await db.run(postTodoQuery);
    response.send('Todo Successfully Added');
} else {
    response.status(400);
    response.send('Invalid Todo Status');
}
});

app.put('/todos/:todoId/', authenticateToken, async (request, response) => {
    const { todoId } = request.params;
    const requestBody = request.body;
    const previousTodoQuery = `SELECT * FROM todo_items WHERE id = ${todoId};`;
    const previousTodo = await db.get(previousTodoQuery);
    const {
        description = previousTodo.description,
        status = previousTodo.status,
    } = request.body;

    let updateTodoQuery;
    switch (true) {
        case requestBody.status !== undefined:
        if (status === 'TO DO' || status === 'DONE') {
            updateTodoQuery = `
            UPDATE todo_items 
            SET description='${description}', status='${status}' 
            WHERE id = ${todoId};`;
            await db.run(updateTodoQuery);
            response.send('Status Updated');
        } else {
            response.status(400);
            response.send('Invalid Todo Status');
        }
        break;

        case requestBody.description !== undefined:
        updateTodoQuery = `
            UPDATE todo_items 
            SET description='${description}', status='${status}' 
            WHERE id = ${todoId};`;
        await db.run(updateTodoQuery);
        response.send('Description Updated');
        break;
    }
});

app.delete('/todos/:todoId/', authenticateToken, async (request, response) => {
const { todoId } = request.params;
const deleteTodoQuery = `
    DELETE FROM todo_items 
    WHERE id = ${todoId};`;
await db.run(deleteTodoQuery);
response.send('Todo Deleted');
});

app.get('/sessions', authenticateToken, async (req, res) => {
    const {user_id} = req.user;  //payload
    const getSessionsQuery = `
      SELECT session_id, user_id, login_time, logout_time 
      FROM sessions where user_id=${user_id}`;
    const sessions = await db.all(getSessionsQuery);
    res.send(sessions);
});

app.post('/logout', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const updateLogoutTimeQuery = `
      UPDATE sessions 
      SET logout_time = CURRENT_TIMESTAMP
      WHERE user_id = ${userId} 
      AND logout_time IS NULL`;
    await db.run(updateLogoutTimeQuery);
    res.send('Logged out successfully');
});

  
module.exports = app

const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');

// Test Interface:
const swaggerUi = require("swagger-ui-express"),
swaggerDocument = require("./swagger.json");

const app = express();

// SQL Server connection config

const config = {
  server: 'yourserver.database.windows.net',
  database: 'yourdatabase',
  user: 'yourusername',
  password: 'yourpassword',
  options: {
    encrypt: true,
    enableArithAbort: true,
  },
};

// Connect to SQL Server
sql.connect(config)
  .then(() => console.log('Connected to SQL Server'))
  .catch((error) => console.log('Error connecting to SQL Server:', error));



// HTTP GET : Get object by ID or by timestamp range
app.get('/object/:id?', async (req, res) => {
  const objectId = req.params.id;
  const fromTimestamp = req.query.from;
  const toTimestamp = req.query.to;

  try {
    let query = '';
    if (objectId) {
      // Get current object state by object ID
      const request = new sql.Request();
      const currentObject = await request.input('objectId', sql.Int, objectId).query('SELECT * FROM objects WHERE objectId = @objectId');
      res.json(currentObject.recordset[0]);
    } else {
      if (fromTimestamp && toTimestamp) {
        const request = new sql.Request();
        request.input('objectId', sql.Int, objectId);
        request.input('fromTimestamp', sql.BigInt, fromTimestamp);
        request.input('toTimestamp', sql.BigInt, toTimestamp);

        const objectStates = await request.query(`SELECT * FROM events WHERE objectId = @objectId AND timestamp BETWEEN @fromTimestamp AND @toTimestamp`);
        res.json(objectStates.recordset);
      } else {
        res.status(400).send('Missing arguments, neither [objectId] or [from] AND [to] was provided.');
        return;
      }
    }
  } catch (error) {
    console.log(error);
    res.status(500).send('Error getting object');
  }
});


// HTTP POST : Create new entity
// TODO: SQL injection removal, by using explicit arguments or sanity checks to stay dynamic.
app.post('/object/:id', bodyParser.json(), async (req, res) => {
  const objectId = req.params.id;
  const attributes = req.body;
  const timestamp = Date.now().toString();

  try {
    // Start distributed transaction
    const transaction = new sql.Transaction();
    await transaction.begin();

    // Insert object
    const attributeNames = Object.keys(attributes).join(', ');
    const attributeValues = Object.values(attributes).map((val) => `'${val}'`).join(', ');
    await request.input('objectId', sql.Int, objectId).query(`INSERT INTO objects (id, ${attributeNames}, revisionId) VALUES (@objectId, ${attributeValues}, @timestamp)`);

    // Update object history
    for (const [attribute, value] of Object.entries(attributes)) {
      await request.input('attribute', sql.NVarChar, attribute).input('value', sql.NVarChar, value).input('timestamp', sql.BigInt, timestamp).input('objectId', sql.Int, objectId).query(`INSERT INTO events (objectId, attribute, value, timestamp) VALUES (@objectId, @attribute, @value, @timestamp)`);
    }

    // Commit transaction
    await transaction.commit();

    res.send('Object inserted successfully');

  } catch (error) {
    console.log(error);
    if (error.number === 2627) {
      // Unique constraint violation error
      res.status(409).send('Object with the given ID already exists');
    } else {
      res.status(500).send('Error inserting object');
    }
  }
});

// HTTP PUT: Update an existing object by ID and attributes
// TODO: SQL injection removal, by using explicit arguments or sanity checks to stay dynamic.
// TODO: Not all attributes are strings
app.put('/object/:id/:revisionId?', bodyParser.json(), async (req, res) => {
  const objectId = req.params.id;
  const attributes = req.body;
  const currentRevisionId = req.params.revisionId; // optional URL parameter
  const timestamp = Date.now().toString();

  try {
    // Start distributed transaction
    const transaction = new sql.Transaction();
    await transaction.begin();

    // Update object attributes,  with or without revision check
    const request = new sql.Request(transaction);
    const attributeUpdates = Object.entries(attributes).map(([attribute, value]) => `${attribute} = '${value}'`).join(', ');

    const revisionConsisteny = (currentRevisionId) ? "AND revisionId = @currentRevisionId" :"";   // Add revision check if specified
    request.input('objectId', sql.Int, objectId);
    request.input('currentRevisionId', sql.BigInt, currentRevisionId);
    const result = await request.query(`UPDATE objects SET ${attributeUpdates}, revisionId = @timestamp WHERE objectId = @objectId ${revisionConsisteny}`);
    if (result.rowsAffected[0] === 0) {
      // Object was updated by another client
      await transaction.rollback();
      res.status(409).send('Conflict: current revision ID does not match');
      return;
    }

    // Update object history for all attributes
    for (const [attribute, value] of Object.entries(attributes)) {
      request.input('attribute', sql.NVarChar, attribute);
      request.input('value', sql.NVarChar, value);
      request.input('timestamp', sql.BigInt, timestamp).input('objectId', sql.Int, objectId);

      await request.query(`INSERT INTO events (objectId, attribute, value, timestamp) VALUES (@objectId, @attribute, @value, @timestamp)`);
    }

    // Commit transaction
    await transaction.commit();

    res.send('Object updated successfully');

  } catch (error) {
    console.log(error);
    res.status(500).send('Error updating object');
  }
});

// HTTP DELETE: Delete an object by ID
app.delete('/object/:id', async (req, res) => {
  const objectId = req.params.id;

  try {
    // Start distributed transaction
    const transaction = new sql.Transaction();
    await transaction.begin();

    // Delete object by ID
    const request = new sql.Request(transaction);
    request.input('objectId', sql.Int, objectId);

    const result = await request.query('DELETE FROM objects WHERE objectId = @objectId');
    if (result.rowsAffected[0] === 0) {
      // Object not found
      await transaction.rollback();
      res.status(404).send('Object not found');
      return;
    }

    // Delete object history
    await request.input('objectId', sql.Int, objectId).query('DELETE FROM events WHERE objectId = @objectId');

    // Commit transaction
    await transaction.commit();

    res.send('Object deleted successfully');

  } catch (error) {
    console.log(error);
    res.status(500).send('Error deleting object');
  }
});

// Development interface
app.use(
  '/developer',
  swaggerUi.serve, 
  swaggerUi.setup(swaggerDocument)
);
  
  // Start server
const port = 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
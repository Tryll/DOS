const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');

const app = express();

// SQL Server connection config
/*
CREATE TABLE objects (
  objectId INT NOT NULL PRIMARY KEY,
  attribute1 VARCHAR(255),
  attribute2 VARCHAR(255),
  revisionId BIGINT,
  INDEX ix_objects_revisionId (revisionId)
);

CREATE TABLE events (
  id INT NOT NULL PRIMARY KEY IDENTITY,
  objectId INT NOT NULL,
  attribute VARCHAR(255),
  value VARCHAR(255),
  timestamp BIGINT,
  INDEX ix_events_objectId (objectId),
  INDEX ix_events_timestamp (timestamp)
);

*/

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
        query = `SELECT * FROM events WHERE objectId = @objectId AND timestamp BETWEEN @fromTimestamp AND @toTimestamp`;
        const request = new sql.Request();
        const objectStates = await request.input('objectId', sql.Int, objectId).input('fromTimestamp', sql.BigInt, fromTimestamp).input('toTimestamp', sql.BigInt, toTimestamp).query(query);
        res.json(objectStates.recordset);
      } else {
        res.status(400).send('Missing arguments, neither objectId or fromTimestamp AND toTimestamp was provided.');
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
  const currentRevisionId = req.params.revisionId || req.query.revisionId; // optional URL parameter
  const timestamp = Date.now().toString();

  try {
    // Start distributed transaction
    const transaction = new sql.Transaction();
    await transaction.begin();

    // Update object and revision ID, and check revision ID
    const request = new sql.Request(transaction);

    // Add revision check if specified
    const revisionConsisteny = (currentRevisionId) ? "AND revisionId = @currentRevisionId" :"";
    const attributeUpdates = Object.entries(attributes).map(([attribute, value]) => `${attribute} = '${value}'`).join(', ');
    const result = await request.input('objectId', sql.Int, objectId).input('currentRevisionId', sql.BigInt, currentRevisionId).query(`UPDATE objects SET ${attributeUpdates}, revisionId = @timestamp WHERE objectId = @objectId ${revisionConsisteny}`);
    if (result.rowsAffected[0] === 0) {
      // Object was updated by another client
      await transaction.rollback();
      res.status(409).send('Conflict: current revision ID does not match');
      return;
    }

    // Update object history
    for (const [attribute, value] of Object.entries(attributes)) {
      await request.input('attribute', sql.NVarChar, attribute).input('value', sql.NVarChar, value).input('timestamp', sql.BigInt, timestamp).input('objectId', sql.Int, objectId).query(`INSERT INTO events (objectId, attribute, value, timestamp) VALUES (@objectId, @attribute, @value, @timestamp)`);
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
    const result = await request.input('objectId', sql.Int, objectId).query('DELETE FROM objects WHERE objectId = @objectId');
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

  
  // Start server
const port = 3000;
app.listen(port, () => {
  console.log("Server started on port ${port}");
});
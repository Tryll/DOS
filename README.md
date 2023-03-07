
Distributed Object Store - DOS


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


npm install express, body-parser, mssql

node DOS.js





const express = require('express');
const configureApp = require('./backend/app');

module.exports = configureApp(express());

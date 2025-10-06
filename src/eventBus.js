const EventEmitter = require("events");

// Singleton event bus for proxy log events
class LogBus extends EventEmitter {}

module.exports = new LogBus();

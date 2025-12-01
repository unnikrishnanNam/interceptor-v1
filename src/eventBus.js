const EventEmitter = require("events");

// Singleton event bus for proxy log events with in-memory backlog buffer
class LogBus extends EventEmitter {
  constructor() {
    super();
    this.buffer = [];
    this.max = 500; // keep last 500 events

    // Capture all log events into buffer
    this.on("log", (evt) => {
      const withTs = evt && evt.ts ? evt : { ts: Date.now(), ...evt };
      this.buffer.push(withTs);
      if (this.buffer.length > this.max) this.buffer.shift();
    });
  }

  getRecent(limit = 200) {
    const n = Math.max(0, Math.min(limit, this.buffer.length));
    return this.buffer.slice(this.buffer.length - n);
  }
}

module.exports = new LogBus();

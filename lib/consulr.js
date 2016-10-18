const EventEmitter = require('events');

const consul = require('consul');
const backoff = require('backoff');
const C = require('./constants');
const decode = require('./decode');
const configMerge = require('./helpers').configMerge;

class Consulr extends EventEmitter {
  constructor(config) {
    super();
    this.config = configMerge(config);

    if (!this.config.prefix || this.config.prefix === '') {
      throw new Error("prefix can't be empty");
    }

    if (this.config.prefix[this.config.prefix.length - 1] !== '/') {
      this.config.prefix += '/';
    }

    this.waitIndex = 0;
    this.consulQuery = {
      key: this.config.prefix,
      recurse: true,
      index: this.waitIndex,
      wait: C.DEFAULT_WAIT_TIME_IN_MINUTE
    };
  }

  run() {
    this.consul = consul();

    this.expBackoff = backoff.exponential({
      initialDelay: 100 * 10, // 1  seconds
      maxDelay: 10000 // 10 seconds
    });

    this.expBackoff.on('backoff', this._backoffHandler.bind(this));
    ['ready', 'fail'].map(evt => this.expBackoff.on(evt, this._backoff.bind(this)));
    this._backoff();
  }

  close() {
    this.removeAllListeners('update');
    this.expBackoff.reset();
  }

  _backoffHandler() {
    this.consul.kv.get(this.consulQuery, (err, result, res) => {
      if (err) {
        this.emit('error', err);
        return this.expBackoff.backoff();
      }

      let metadata = this.consul.parseQueryMeta(res);
      // if same, there is no changes
      if (metadata.LastIndex === this.waitIndex) {
        return;
      }

      this.waitIndex = metadata.LastIndex;
      this._reset();
      let decodeResult = decode(result, this.config.prefix);
      this.emit('update', decodeResult);
      this._reschedule();
    });
  }

  _reschedule() {
    this.qscPeriodTimerId = setTimeout(() => {
      this.expBackoff.backoff();
      clearTimeout(this.qscPeriodTimerId);
    }, this.config.quiescencePeriodInMs);
  }

  _backoff() {
    this.expBackoff.backoff();
  }

  _reset(){
    this.expBackoff.reset();
  }
}

module.exports = Consulr;
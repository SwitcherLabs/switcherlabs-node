'use strict';

const http = require('http');
const https = require('https');

const defaultHttpAgent = new http.Agent({keepAlive: true});
const defaultHttpsAgent = new https.Agent({keepAlive: true});

const DEFAULT_HOST = 'api.switcherlabs.com';
const DEFAULT_PORT = '443';
const DEFAULT_TIMEOUT = 60000;
const PACKAGE_VERSION = require('../package.json').version;

const STATE_REFRESH_RATE = 60000;
const IDENTITY_REFRESH_RATE = 5000;

const OPERATIONS = {
  '==': (a, b) => a == b,
  '!=': (a, b) => a != b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
};

function SwitcherLabs(config = {}) {
  if (!(this instanceof SwitcherLabs)) {
    return new SwitcherLabs(config);
  }
  if (!config.api_key) {
    throw new Error(
      'You must set api_key in the config when initializing a SwitcherLabs client.'
    );
  }

  const opts = {
    api_key: config.api_key,
    user_agent: `switcherlabs-node/${PACKAGE_VERSION} node/${process.version}`,
    host: config.host || DEFAULT_HOST,
    port: config.port || DEFAULT_PORT,
    protocol: config.protocol || 'https',
    timeout: config.timeout || DEFAULT_TIMEOUT,
  };

  let _flags = {};
  let _flagsByID = {};
  let _overrides = {};
  const _identities = {};

  let _lastRefresh = 0;

  refreshState();

  function timeoutHandler(timeout, req) {
    return () => {
      const timeoutErr = new TypeError('ETIMEDOUT');
      timeoutErr.code = 'ETIMEDOUT';

      req.destroy(timeoutErr);
    };
  }

  function responseHandler(req, callback) {
    return (res) => {
      let response = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        response += chunk;
      });
      res.once('end', () => {
        try {
          response = JSON.parse(response);

          if (response.error) {
            response.error.statusCode = res.statusCode;

            return callback.call(this, response.error, null);
          }
        } catch (e) {
          return callback.call(this, e, null);
        }

        callback.call(this, null, response);
      });
    };
  }

  function makeHeaders() {
    const credentials = Buffer.from(`:${opts.api_key}`).toString('base64');

    return {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': opts.user_agent,
    };
  }

  function request(method, path, callback) {
    const requestData = Buffer.from('');

    const timeout = opts.timeout;
    const isInsecureConnection = opts.protocol === 'http';
    const agent = isInsecureConnection ? defaultHttpAgent : defaultHttpsAgent;
    const headers = makeHeaders();

    const req = (isInsecureConnection ? http : https).request({
      host: opts.host,
      port: opts.port,
      path,
      method,
      agent,
      headers,
      ciphers: 'DEFAULT:!aNULL:!eNULL:!LOW:!EXPORT:!SSLv2:!MD5',
    });

    req.setTimeout(timeout, timeoutHandler(timeout, req, callback));

    req.once('response', (res) => {
      return responseHandler(req, callback)(res);
    });

    req.on('error', (error) => {
      console.log('error');
      if (error.code === 'ETIMEDOUT') {
        return callback.call(
          this,
          new Error(
            `Request aborted due to timeout being reached (${timeout}ms)`
          )
        );
      }
      return callback.call(this, error, null);
    });

    req.once('socket', (socket) => {
      if (socket.connecting) {
        socket.once(isInsecureConnection ? 'connect' : 'secureConnect', () => {
          // Send payload; we're safe:
          req.write(requestData);
          req.end();
        });
      } else {
        // we're already connected
        req.write(requestData);
        req.end();
      }
    });
  }

  function refreshState() {
    return new Promise((resolve, reject) => {
      if (_lastRefresh + STATE_REFRESH_RATE > Date.now()) {
        return resolve();
      }

      request('GET', '/sdk/initialize', (err, {flags, overrides}) => {
        if (err) {
          reject(err);
        } else {
          const currentTime = Date.now();

          const newFlags = {};
          const newFlagsByID = {};
          for (const flag of flags) {
            newFlags[flag.key] = flag;
            newFlagsByID[flag.id] = flag;
          }

          const newOverrides = {};
          for (const override of overrides) {
            newOverrides[override.key] = override;
          }

          _flags = newFlags;
          _flagsByID = newFlagsByID;
          _overrides = newOverrides;
          _lastRefresh = currentTime;

          for (const identifier in _identities) {
            if (
              _identities[identifier].fetchedAt + IDENTITY_REFRESH_RATE <
              currentTime
            ) {
              delete _identities[identifier];
            }
          }

          resolve();
        }
      });
    });
  }

  function fetchIdentity(identifier, callback) {
    return callbackifyPromiseWithTimeout(
      new Promise((resolve, reject) => {
        if (identifier in _identities) {
          const identity = _identities[identifier];
          if (identity.fetchedAt + IDENTITY_REFRESH_RATE > Date.now()) {
            return resolve(identity);
          }
        }

        request('GET', `/sdk/identities/${identifier}`, (err, response) => {
          if (err) {
            reject(err);
          } else {
            response.fetchedAt = Date.now();
            _identities[identifier] = response;
            resolve(response);
          }
        });
      }),
      callback
    );
  }

  this.evaluateFlag = function({key, identifier, overrides = {}}, callback) {
    return callbackifyPromiseWithTimeout(
      new Promise((resolve, reject) => {
        if (!(key in _flags)) {
          return reject(new Error('flag requested does not exist'));
        }

        resolve();
      })
        .then(() => {
          if (!identifier) {
            return null;
          }
          return fetchIdentity(identifier);
        })
        .then((identity) => {
          if (key in overrides) {
            return overrides[key];
          } else if (identity && key in identity.overrides) {
            return identity.overrides[key];
          } else {
            return refreshState().then(() => {
              if (key in _overrides) {
                return _overrides[key].value;
              }

              if (_flags[key].dynamic_rules.length) {
                for (const rule of _flags[key].dynamic_rules) {
                  const expressionFlag = _flagsByID[rule.expression.flag_id];
                  const expressionFlagKey = expressionFlag.key;

                  let flagValue;
                  if (expressionFlagKey in overrides) {
                    flagValue = overrides[expressionFlagKey];
                  } else if (
                    identity &&
                    expressionFlagKey in identity.overrides
                  ) {
                    flagValue = identity.overrides[expressionFlagKey];
                  } else if (expressionFlagKey in _overrides) {
                    flagValue = _overrides[expressionFlagKey].value;
                  } else {
                    flagValue = expressionFlag.value;
                  }

                  if (
                    OPERATIONS[rule.expression.op](
                      flagValue,
                      rule.expression.value
                    )
                  ) {
                    return rule.value;
                  }
                }
              }

              return _flags[key].value;
            });
          }
        }),
      callback
    );
  };
}

const callbackifyPromiseWithTimeout = (promise, callback) => {
  if (callback) {
    // Ensure callback is called outside of promise stack.
    return promise.then(
      (res) => {
        setTimeout(() => {
          callback(null, res);
        }, 0);
      },
      (err) => {
        setTimeout(() => {
          callback(err, null);
        }, 0);
      }
    );
  }

  return promise;
};

module.exports = SwitcherLabs;
module.exports.default = SwitcherLabs;

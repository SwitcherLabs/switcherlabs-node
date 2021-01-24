# SwitcherLabs Node.js SDK

SwitcherLabs is a feature flagging management platform that allows you to get
started using feature flags in no time. The SwitcherLabs Node.js SDK allows you
to easily integrate feature flags in your Node.js projects.

## Installation

Install the package with:

```sh
npm install switcherlabs --save
# or
yarn add switcherlabs
```

## Usage

The package needs to be configured with your environments API Key, which is available in your SwitcherLabs dashboard under the environment details of the project you wish to use.

<!-- prettier-ignore -->
```js
const switcherlabs = require('switcherlabs')({
  api_key: '<YOUR_API_KEY HERE>'
});

switcherlabs.evaluateFlag({
  key: 'user_123',
  identifier: 'new_feature_flag',
})
  .then((flagEnabled) => {
    if (flagEnabled) {
      // Do something if flag is enabled
    } else {
      // Else do something else.
    }
  })
```

Or `async`/`await`:

<!-- prettier-ignore -->
```js
const switcherlabs = require('switcherlabs')({
  api_key: '<YOUR_API_KEY HERE>'
});

(async () => {
  const flagEnabled = await switcherlabs.evaluateFlag({
    key: 'user_123',
    identifier: 'new_feature_flag',
  })

  if (flagEnabled) {
    // Do something if flag is enabled
  } else {
    // Else do something else.
  }
})();
```

Or using a `callback`:

<!-- prettier-ignore -->
```js
const switcherlabs = require('switcherlabs')({
  api_key: '<YOUR_API_KEY HERE>'
});

switcherlabs.evaluateFlag(
  {
    key: 'user_123',
    identifier: 'new_feature_flag',
  },
  (err, flagEnabled) => {
    if (flagEnabled) {
      // Do something if flag is enabled
    } else {
      // Else do something else.
    }
  }
);
```

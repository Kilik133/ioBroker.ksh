/**
 *
 *      KSH Adapter
 *
 *      (c) Kilik <kilik133@gmail.com>
 *
 *      MIT License
 *
 */
'use strict';

const utils         = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName   = require('./package.json').name.split('.').pop();
let adapter;

let server = null;
let states = {};

const messageboxRegex = new RegExp('\\.messagebox$');

function decrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});

    adapter = new utils.Adapter(options);

    adapter.on('message', obj =>
        obj && processMessage(obj));

    adapter.on('ready', () => {
        adapter.config.pass = decrypt('Zgfr56gFe87jJOM', adapter.config.pass);
        adapter.config.maxTopicLength = adapter.config.maxTopicLength || 100;
        if (adapter.config.ssl && adapter.config.type === 'server') {
            // Load certificates
            adapter.getCertificates((err, certificates) => {
                adapter.config.certificates = certificates;
                main();
            });
        } else {
            // Start
            main();
        }
    });

    adapter.on('unload', () => {
        server && server.destroy();
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        adapter.log.debug(`stateChange ${id}: ${JSON.stringify(state)}`);
        // State deleted
        if (!state) {
            delete states[id];
            if (server) server.onStateChange(id);
        } else
        // you can use the ack flag to detect if state is desired or acknowledged
        if ((adapter.config.sendAckToo || !state.ack) && !messageboxRegex.test(id)) {
            const oldVal = states[id] ? states[id].val : null;
            const oldAck = states[id] ? states[id].ack : null;
            states[id] = state;

            // If value really changed
            if (!adapter.config.onchange || oldVal !== state.val || oldAck !== state.ack) {
                // If SERVER
                server && server.onStateChange(id, state);
            }
        }
    });
    return adapter;
}

function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch (obj.command) {
        case 'sendMessage2Client':
            if (server) {
                adapter.log.debug(`Sending message from server to clients via topic ${obj.message.topic}: ${obj.message.message} ...`);
                server.onMessage(obj.message.topic, obj.message.message);
            } else {
                adapter.log.debug(`Neither MQTT client not started, thus not sending message via topic ${obj.message.topic} (${obj.message.message}).`);
            }
            break;

        case 'sendState2Client':
            if (server) {
                adapter.log.debug(`Sending message from server to clients ${obj.message.id}: ${obj.message.state} ...`);
                server.onStateChange(obj.message.id, obj.message.state);
            } else {
                adapter.log.debug(`Neither MQTT client not started, thus not sending message to client ${obj.message.id} (${obj.message.state}).`);
            }
            break;
    }
}

let cnt = 0;
function readStatesForPattern(pattern) {
    adapter.getForeignStates(pattern, (err, res) => {
        if (!err && res) {
            states = states || {};

            Object.keys(res).filter(id => !messageboxRegex.test(id))
                .forEach(id => states[id] = res[id]);
        }
        // If all patters answered, start server
        if (!--cnt) {
                server = new require('./lib/server')(adapter, states);
        }
    });
}

function main() {
    adapter.config.forceCleanSession = adapter.config.forceCleanSession || 'no'; // default

    // Subscribe on own variables to publish it
    if (adapter.config.publish) {
        const parts = adapter.config.publish.split(',');
        for (let t = 0; t < parts.length; t++) {
            if (parts[t].indexOf('#') !== -1) {
                adapter.log.warn(`Used MQTT notation for ioBroker in pattern "${parts[t]}": use "${parts[t].replace(/#/g, '*')} notation`);
                parts[t] = parts[t].replace(/#/g, '*');
            }
            adapter.subscribeForeignStates(parts[t].trim());
            cnt++;
            readStatesForPattern(parts[t]);
        }
    } else {
        // subscribe for all variables
        adapter.subscribeForeignStates('*');
        readStatesForPattern('*');
    }

    adapter.config.defaultQoS = parseInt(adapter.config.defaultQoS, 10) || 0;
    adapter.config.retain = adapter.config.retain === 'true' || adapter.config.retain === true;
    adapter.config.persistent = adapter.config.persistent === 'true' || adapter.config.persistent === true;
    adapter.config.retransmitInterval = parseInt(adapter.config.retransmitInterval, 10) || 2000;
    adapter.config.retransmitCount = parseInt(adapter.config.retransmitCount, 10) || 10;

    if (adapter.config.retransmitInterval < adapter.config.sendInterval) {
        adapter.config.retransmitInterval = adapter.config.sendInterval * 5;
    }
    adapter.EXIT_CODES = utils.EXIT_CODES || {
        ADAPTER_REQUESTED_TERMINATION: 11
    };

    // If no subscription, start server
    if (!cnt) {
            server = new require(__dirname + '/lib/server')(adapter, states);
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}

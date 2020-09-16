#!/usr/bin/env node
"use strict";
const dhcp = require('dhcp');
const tftp = require('tftp');
const fs = require("fs");
const http = require("http");
const url = require('url');

var dhcpMessageTypes = {
    1: 'DHCPDISCOVER',
    2: 'DHCPOFFER',
    3: 'DHCPREQUEST',
    4: 'DHCPDECLINE',
    5: 'DHCPACK',
    6: 'DHCPNAK',
    7: 'DHCPRELEASE',
    8: 'DHCPINFORM'
};

var clients = {};

var ipMap = {};

var stages = [
    "firstContact",
    "IPAssigned",
    "menu",
    "booting",
    "booted"
];

function initialize(options) {
    if (!options) {
        throw Error("No options provided to initialize server. See README.md for help.");
    }
    logger("log", " PXE server started.");
    startDHCPServer(options.dhcpOptions, options.bindHost);
    startTFTPServer(options.tftpOptions);
    if (options.apiEnabled) {
        startAPIServer(options.apiOptions);
    }
    else {
        logger("log", "Not starting API server as it is disabled");
    }
    if (options.configurePxeLinux) {
        configurePxeLinux(options.pxeLinuxOptions);
    }
    else {
        logger("log", "Not configuring PXE Linux as it is disabled");
    }
    // Function to delete clients after they've completed the process and have been inactive for a while. Without this, it'd be 
    // necessary to have the clients call home on boot or depend on boot image specific cues 
    setInterval(() => {
        var clientsKeys = Object.keys(clients);
        for (var i = 0; i < clientsKeys.length; i++) {
            if ((new Date()).valueOf() - clients[clientsKeys[i]].lastActiveDate >= 20000000) {
                logger("log", "Removing client " + clientsKeys[i] + " from the list of clients as it has expired");
                delete clients[clientsKeys[i]];
            }
        }
    }, 21600000);
}

async function startAPIServer(apiOptions) {
    const host = apiOptions.host;
    const port = apiOptions.port;

    const server = http.createServer((req, res) => {
        if (req.method === 'GET') {
            const { pathname } = url.parse(req.url)
            if (pathname == '/clients') {
                res.setHeader('Content-Type', 'application/json;charset=utf-8');
                return res.end(JSON.stringify(clients));
            }
            else if (pathname == '/ipmap') {
                res.setHeader('Content-Type', 'application/json;charset=utf-8');
                return res.end(JSON.stringify(ipMap));
            }
            else {
                res.statusCode = 404
                return res.end(`{"error": "${http.STATUS_CODES[404]}"}`);
            }
        }
    })
    server.listen(port)
}

async function startDHCPServer(dhcpOptions, bindHost) {
    // This one is already defined but only has attr not config so will bug out if not redefined
    dhcp.addOption(60, {
        name: 'Vendor Class-Identifier',
        type: 'ASCII',
        attr: 'vendorClassId',
        config: "vendorClassId"
    });
    // Adding extra DHCP options needed to boot into PXE. Context for the whole undefined PXE option 
    // thing is in RFC4578
    dhcp.addOption(97, {
        config: "ClientID",
        type: "ASCII",
        name: "UUID/GUID-based client identifier"
    });
    dhcp.addOption(93, {
        config: "clientSystem",
        type: "ASCII",
        name: "Client system architecture"
    });
    dhcp.addOption(94, {
        config: "clientNetwork",
        type: "ASCII",
        name: "Client network device interface"
    });
    dhcp.addOption(128, {
        config: "PXEOption1",
        type: "ASCII",
        name: "PXE undefined option 1, TFTP Server IP Address"
    });
    dhcp.addOption(129, {
        config: "PXEOption2",
        type: "ASCII",
        name: "PXE undefined option 2, Call Server IP Address"
    });
    dhcp.addOption(130, {
        config: "PXEOption3",
        type: "ASCII",
        name: "PXE undefined option 3, Discrimination string to identify vendor"
    });
    dhcp.addOption(131, {
        config: "PXEOption4",
        type: "ASCII",
        name: "PXE undefined option 4, Remote Statistics Server IP Address"
    });
    dhcp.addOption(132, {
        config: "PXEOption5",
        type: "ASCII",
        name: "PXE undefined option 5, 802.1Q VLAN ID"
    });
    dhcp.addOption(133, {
        config: "PXEOption6",
        type: "ASCII",
        name: "PXE undefined option 6, 802.1Q L2 Priority"
    });
    dhcp.addOption(134, {
        config: "PXEOption7",
        type: "ASCII",
        name: "PXE undefined option 7, Diffserv code point for VoIP signalling and media streams"
    });
    dhcp.addOption(135, {
        config: "PXEOption8",
        type: "ASCII",
        name: "PXE undefined option 8"
    });
    var s = dhcp.createServer(dhcpOptions);

    s.on('message', function (data) {
        // Add DHCP message event to client
        var eventOptions = {
            "lastEvent": "DHCP Message " + dhcpMessageTypes[data.options["53"]],
            "mac": data.chaddr
        };
        if (!clients[data.chaddr]) {
            eventOptions.stage = stages[0];
        }
        if (data.options["12"]) {
            eventOptions.hostname = data.options["12"];
            eventOptions.stage = stages[4];
        }
        addEvent(eventOptions);
        logger("debug", "DHCP message " + JSON.stringify(data.options));
    });

    s.on('bound', function (state) {
        // Add DCHP bound event to client
        var leases = Object.keys(state);
        for (var i = 0; i < leases.length; i++) {
            if (!clients[leases[i]].ip && state[leases[i]].state == "BOUND" && clients[leases[i]].ip != state[leases[i]].address) {
                // Add a key for the IP to the IP map and assign the MAC address to it. 
                ipMap[state[leases[i]].address] = leases[i];
                addEvent({
                    "stage": stages[1],
                    "lastEvent": "DHCP address bound",
                    "mac": leases[i],
                    "ip": state[leases[i]].address
                });
            }
            else if (clients[leases[i]].ip && state[leases[i]].state == "BOUND") {
                addEvent({
                    "lastEvent": "DHCP address bound on previously contacted client",
                    "mac": leases[i],
                    "ip": state[leases[i]].address
                });
            }
        }
        logger("log", "DHCP bound " + JSON.stringify(state));
    });

    s.on("error", function (err, data) {
        // DHCP errors are usually major failures. Exiting like this may still be a bit too extreme though.
        logger("error", "DHCP error " + JSON.stringify(err) + " " + (data ? JSON.stringify(data) : "") + " Exiting");
        process.exit(1);
    });
    // If requested to bind to a specific host
    if (bindHost) {
        s.listen(0, bindHost);
    }
    else {
        s.listen();
    }
}

async function startTFTPServer(tftpOptions) {
    var server = tftp.createServer(tftpOptions);
    server.on("request", function (req) {
        // Uses pxelinux.cfg as sign to determine what stage of the boot process client is in. If not using pxelinux,
        // just goes from IPAssigned to booting and skips menu step
        if (ipMap[req.stats.remoteAddress]) {
            var eventOptions = {
                "stage": (req.file.includes("pxelinux.cfg") ? stages[2] : stages[3]),
                "lastEvent": "File requested " + req.file,
                "mac": ipMap[req.stats.remoteAddress],
            };
            addEvent(eventOptions);
        }
        logger("log", "TFTP request. Method: " + req.method + " File: " + req.file + " Requesting IP: " + req.stats.remoteAddress);
        // If an error occurs within the request 
        req.on("error", function (error) {
            // Handles file not found/permissions errors
            if (error.path) {
                logger("error", "Error from the TFTP request. " + JSON.stringify(error));
            }
            else {
                // Other errors
                logger("error", "Error from the TFTP request. " + error.name + " " + error.message + " " +
                    (error.stack ? error.stack : "") + " " + (error.status ? error.status.toString() : ""));
            }

            if (ipMap[req.stats.remoteAddress]) {
                var eventOptions = {
                    "stage": (req.file.includes("pxelinux.cfg") ? stages[2] : stages[3]),
                    "lastEvent": "File request failed " + req.file,
                    "mac": ipMap[req.stats.remoteAddress],
                };
                addEvent(eventOptions);
            }
        });
    });

    server.on("error", function (error) {
        logger("error", "Error from the main TFTP socket. " + JSON.stringify(error) + " Exiting");
        process.exit(2);
    });
    server.listen()
}

function addEvent(eventOptions) {
    // If client doesn't exist in clients list
    if (!clients[eventOptions.mac] && eventOptions.mac) {
        clients[eventOptions.mac] = {
            "stage": "",
            "lastEvent": "",
            "ip": "",
            "lastActiveDate": "",
            "hostname": ""
        };
    }
    // Set values of all keys except lastActiveDate
    var eventOptionsKeys = Object.keys(eventOptions);
    for (var i = 0; i < eventOptionsKeys.length; i++) {
        if (eventOptionsKeys[i] != "mac") {
            clients[eventOptions.mac][eventOptionsKeys[i]] = eventOptions[eventOptionsKeys[i]];
        }
    }
    clients[eventOptions.mac]["lastActiveDate"] = (new Date()).valueOf();
}

function logger(level, message) {
    message = "[" + (new Date()).valueOf() + "]  " + level.toUpperCase() + ": " + message.toString();
    console[level](message);
}

function configurePxeLinux(pxeLinuxOptions) {
    var configs = Object.keys(pxeLinuxOptions.configs);
    var fileContents = "";
    var keys = [];
    var header;
    var bootOptions;
    // Each top level key under pxeLinuxOptions.configs represents a separate file. 
    for (var config = 0; config < configs.length; config++) {
        header = pxeLinuxOptions.configs[configs[config]].header;
        bootOptions = pxeLinuxOptions.configs[configs[config]].bootOptions;
        fileContents = "";
        // Create file header section
        keys = Object.keys(header);
        for (var key = 0; key < keys.length; key++) {
            fileContents += keys[key] + " " + header[keys[key]] + "\n";
        }
        // Create boot options
        for (var option = 0; option < bootOptions.length; option++) {
            if (!bootOptions[option]["label"]) {
                logger("error", "Config option " + option.toString() + " for config " + configs[config] + " does not have a label");
            }
            else {
                fileContents += "\n" + "label " + bootOptions[option]["label"] + "\n";
                if (bootOptions[option]["menu label"]) {
                    fileContents += "    menu label " + bootOptions[option]["menu label"] + "\n";
                }
                fileContents += "    " + bootOptions[option]["action"] + "\n";
            }
        }
        fs.writeFileSync(pxeLinuxOptions.location + "/" + configs[config], fileContents);
        logger("log", "PXE Linux configuration for " + configs[config] + " generated \n" + fileContents);
    }
}

function getClients() {
    return clients;
}
function getIpMap() {
    return ipMap;
}
// If we're being called from a terminal
if (require.main === module) {
    if (process.argv.length == 3) {
        logger("log", "Loading config from file " + process.argv[2]);
        let options;
        try {
            options = require(process.argv[2]);
        }
        catch (e) {
            logger("error", "Error loading config from file " + process.argv[2]);
            throw e;
        }
        initialize(options);
    }
    else {
        logger("error", "Please include a path to an options file. See README.md for details.");
        process.exit(3);
    }
}
module.exports.initialize = initialize
module.exports.getClients = getClients
module.exports.getIpMap = getIpMap
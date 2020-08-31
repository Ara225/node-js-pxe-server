"use strict"
var dhcp = require('dhcp');
var tftp = require('tftp')
var options = require('./options.json')
var fs = require("fs")
var http = require("http")
const url = require('url');
const { Console } = require('console');
var dhcpMessageTypes = {
    1: 'DHCPDISCOVER',
    2: 'DHCPOFFER',
    3: 'DHCPREQUEST',
    4: 'DHCPDECLINE',
    5: 'DHCPACK',
    6: 'DHCPNAK',
    7: 'DHCPRELEASE',
    8: 'DHCPINFORM'
}
var clients = {}
var ipMap = {}
var stages = [
                   "firstContact",
                   "IPAssigned",
                   "menu",
                   "booting",
                   "booted"
               ]

function initialize() {
    logger("log", " PXE server started.");
    if (options.dhcpEnabled) {
        startDHCPServer(options.dhcpOptions)
    }
    else {
        logger("log", "Not starting DHCP server as it is disabled")
    }
    if (options.tftpEnabled) {
        startTFTPServer(options.tftpOptions)
    }
    else {
        logger("log", "Not starting TFTP server as it is disabled")
    }
    if (options.apiEnabled) {
        startAPIServer(options.apiOptions)
    }
    else {
        logger("log", "Not starting API server as it is disabled")
    }
    // Simple setup for rotating log file. Use system to redirect output, but we can't rely on it rotating it 
    // as we could be running on Windows or Linux
    fs.exists(options.logFile, (exists) => {
        if (exists) {
            logger("log", "Log file exists");
            setInterval(() => {
                if (fs.statSync(options.logFile).size > 50000000) {
                    fs.writeFile(options.logFile, "Log file rotated", (err) => {
                        logger("error", "Error rotating log file " + JSON.stringify(err))
                    })
                }
                
                var clientsKeys = Object.keys(clients)
                for (var i = 0; i < clientsKeys.length; i++) {
                    if ((new Date()).valueOf() - clients[clientsKeys[i]].lastActiveDate >= 21600000) {
                        logger("log", "Removing client " + clientsKeys[i] + " from the list as it has expired");
                        console.log(clients)
                        delete clients[clientsKeys[i]]
                        
                    }
                }
            }, 21600000);
        }
        else {
            logger("log", "Log file does not exist");
        }
    })
}

async function startAPIServer(apiOptions) {
    const host = apiOptions.host
    const port = apiOptions.port

    const server = http.createServer((req, res) => {
        if (req.method === 'GET') {
            const { pathname } = url.parse(req.url)
            if (pathname == '/clients') {
                res.setHeader('Content-Type', 'application/json;charset=utf-8');
                return res.end(JSON.stringify(clients))
            }
            else if (pathname == '/ipmap') {
                res.setHeader('Content-Type', 'application/json;charset=utf-8');
                return res.end(JSON.stringify(ipMap))
            }
            else {
                res.statusCode = 404
                return res.end(`{"error": "${http.STATUS_CODES[404]}"}`)
            }
        }
    })
    server.listen(port)
}

async function startDHCPServer(dhcpOptions) {
    dhcp.addOption(60, {
        name: 'Vendor Class-Identifier',
        type: 'ASCII',
        attr: 'vendorClassId',
        config: "vendorClassId"
    })

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
        config: "tftpServerIP",
        type: "ASCII",
        name: "TFTP Server IP Address"
    });
    dhcp.addOption(129, {
        config: "callServerIPAddress",
        type: "ASCII",
        name: "Call Server IP Address"
    });
    dhcp.addOption(130, {
        config: "discriminationString",
        type: "ASCII",
        name: "Discrimination string to identify vendor"
    });
    dhcp.addOption(131, {
        config: "statisticsServer",
        type: "ASCII",
        name: "Remote Statistics Server IP Address"
    });
    dhcp.addOption(132, {
        config: "vlanID",
        type: "ASCII",
        name: "802.1Q VLAN ID"
    });
    dhcp.addOption(133, {
        config: "L2Priority",
        type: "ASCII",
        name: "802.1Q L2 Priority"
    });
    dhcp.addOption(134, {
        config: "testConfig9",
        type: "ASCII",
        name: "Test Option9"
    });
    dhcp.addOption(135, {
        config: "Diffserv",
        type: "ASCII",
        name: "Diffserv code point for VoIP signalling and media streams"
    });
    var s = dhcp.createServer(dhcpOptions);

    s.on('message', function (data) {
        var options = {
                           "lastEvent": "DHCP Message " + dhcpMessageTypes[data.options["53"]],
                           "mac": data.chaddr
                       }
        if (!clients[data.chaddr]) {
            options.stage = stages[0]
        }
        if (data.options["12"]) {
            options.hostname = data.options["12"]
            options.stage = stages[4]
        }
        addEvent(options)
        logger("debug", "DHCP message " + JSON.stringify(data.options))
    });

    s.on('bound', function (state) {
        var leases = Object.keys(state)
        for (var i = 0; i < leases.length; i++) {
            if (!clients[leases[i]].ip && state[leases[i]].state == "BOUND" && clients[leases[i]].ip != state[leases[i]].address) {
                ipMap[state[leases[i]].address] = leases[i]
                addEvent({
                    "stage": stages[1],
                    "lastEvent": "DHCP address bound",
                    "mac": leases[i],
                    "ip": state[leases[i]].address
                })
            }
        }
        logger("log", "DHCP bound " + JSON.stringify(state))
    });

    s.on("error", function (err, data) {
        logger("error", "DHCP error " + JSON.stringify(err) + " " + (data ? JSON.stringify(data) : "")  + " Exiting")
        process.exit(1)
    });
    if (options.bindHost) {
        s.listen(0, options.bindHost);
    }
    else {
        s.listen();
    }
}

async function startTFTPServer(tftpOptions) {
    var server = tftp.createServer(tftpOptions);
    server.on("request", function (req) {
        if (ipMap[req.stats.remoteAddress]) {
            var options = {
                "stage": (req.file.includes("pxelinux.cfg") ? stages[2] : stages[3]),
                "lastEvent": "File requested " + req.file,
                "mac": ipMap[req.stats.remoteAddress],
            }
            addEvent(options)
        }
        logger("log", "TFTP request. Method: " + req.method + " File: " + req.file + " Requesting IP: " + req.stats.remoteAddress)
        req.on("error", function (error) {
            if (error.path){
                logger("error", "Error from the TFTP request. " + JSON.stringify(error))
            }
            else {
                logger("error", "Error from the TFTP request. " + error.name + " " + error.message +  " " +
                (error.stack ? error.stack : "") + " " + (error.status ? error.status.toString() : ""))
            }
            
            if (ipMap[req.stats.remoteAddress]) {
                var options = {
                    "stage": (req.file.includes("pxelinux.cfg") ? stages[2] : stages[3]),
                    "lastEvent": "File request failed " + req.file,
                    "mac": ipMap[req.stats.remoteAddress],
                }
                addEvent(options)
            }
        });
    });

    server.on("error", function (error) {
        logger("error", "Error from the main TFTP socket. " + JSON.stringify(error) + " Exiting")
        process.exit(2)
    });
    server.listen()
}

function addEvent(options) {
    if (!clients[options.mac] && options.mac) {
        clients[options.mac] = {
            "stage": "",
            "lastEvent": "",
            "ip": "",
            "osInstalling": "",
            "lastActiveDate": "",
            "hostname": ""
        }
    }
    var optionsKeys = Object.keys(options)
    for (var i = 0; i < optionsKeys.length; i++) {
        if (optionsKeys[i] != "mac") {
            clients[options.mac][optionsKeys[i]] = options[optionsKeys[i]]
        }
    }
    clients[options.mac]["lastActiveDate"] = (new Date()).valueOf()
}

function logger(level, message) {
    message = "[" + (new Date()).valueOf() + "] " + message.toString()
    console[level](message)
}
initialize()
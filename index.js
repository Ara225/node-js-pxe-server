var dhcp = require('dhcp');
var tftp = require('tftp')
var options = require('./options.json')
var fs = require("fs")
var http = require("http")
const url = require('url')
var dhcpLeases = {}
var lastMessages = []
var lastUpdate = 0;

function initialize() {
    console.log("[" + (new Date()).toISOString() + "] " + " PXE server started.");
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
            if (pathname == '/leases') {
                res.setHeader('Content-Type', 'application/json;charset=utf-8');
                return res.end(JSON.stringify(dhcpLeases))
            }
            else if (pathname == '/messages') {
                res.setHeader('Content-Type', 'application/json;charset=utf-8');
                return res.end(JSON.stringify({ messages: JSON.stringify(lastMessages) }))
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
        logger("debug", "DHCP message " + JSON.stringify(data.options))
    });

    s.on('bound', function (state) {
        dhcpLeases = state
        logger("log", "DHCP bound " + JSON.stringify(state))
    });

    s.on("error", function (err, data) {
        logger("error", JSON.stringify(err) + " " + JSON.stringify(data))
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
        logger("log", "File requested. Method: " + req.method + " File: " + req.file + " Requesting IP: " + req.stats.remoteAddress)
        req.on("error", function (error) {
            logger("error", "Error from the TFTP request. " + JSON.stringify(error))
        });
    });

    server.on("error", function (error) {
        logger("error", "Error from the main TFTP socket. " + JSON.stringify(error))
    });
    server.listen()
}

function logger(level, message) {
    message = "[" + (new Date()).toISOString() + "] " + message.toString()
    console[level](message)

    if (((new Date()).valueOf()-lastUpdate) >= options.millisecondsToKeep || !lastMessages.length) {
        lastMessages = [message]
        lastUpdate = (new Date()).valueOf()
    }
    else {
        lastMessages.push(message)
    }
}
initialize()
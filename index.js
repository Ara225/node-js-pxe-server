var dhcp = require('dhcp');
var tftp = require('tftp')
var options = require('./options.json')


function initialize() {
    console.timeStamp();
    console.log("PXE server started. Options are:");
    console.log(options)

    startDHCPServer()
    startTFTPServer()
}

async function startDHCPServer(dhcpOptions) {
    var s = dhcp.createServer(dhcpOptions);

    dhcp.addOption(60, {
        name: 'Vendor Class-Identifier',
        type: 'ASCII',
        attr: 'vendorClassId',
        config: "vendorClassId"
    })

    dhcp.addOption(97, {
        config: "testConfig1",
        type: "ASCII",
        name: "Test Option1"
    });
    dhcp.addOption(93, {
        config: "testConfig2",
        type: "ASCII",
        name: "Test Option2"
    });
    dhcp.addOption(94, {
        config: "testConfig3",
        type: "ASCII",
        name: "Test Option3"
    });
    dhcp.addOption(128, {
        config: "testConfig4",
        type: "ASCII",
        name: "Test Option4"
    });
    dhcp.addOption(129, {
        config: "testConfig4",
        type: "ASCII",
        name: "Test Option4"
    });
    dhcp.addOption(130, {
        config: "testConfig5",
        type: "ASCII",
        name: "Test Option5"
    });
    dhcp.addOption(131, {
        config: "testConfig6",
        type: "ASCII",
        name: "Test Option6"
    });
    dhcp.addOption(132, {
        config: "testConfig7",
        type: "ASCII",
        name: "Test Option7"
    });
    dhcp.addOption(133, {
        config: "testConfig8",
        type: "ASCII",
        name: "Test Option8"
    });
    dhcp.addOption(134, {
        config: "testConfig9",
        type: "ASCII",
        name: "Test Option9"
    });
    dhcp.addOption(135, {
        config: "testConfig10",
        type: "ASCII",
        name: "Test Option10"
    });
    s.on('message', function (data) {
        console.timeStamp();
        console.log("DHCP message");
        console.log(data);
    });

    s.on('bound', function (state) {
        console.timeStamp();
        console.log("DHCP bound");
        console.log(state);
    });

    s.on("error", function (err, data) {
        console.timeStamp();
        console.log("DHCP error");
        console.error(err, data);
    });

    s.listen();
}

async function startTFTPServer(tftpOptions) {
    var server = tftp.createServer(tftpOptions);

    server.on("request", function (req) {
        console.timeStamp()
        console.log(req);
        req.on("error", function (error) {
            console.timeStamp()
            console.error("Error from the TFTP request");
            console.error(error);
        });

        req.on("close", function () {
            console.timeStamp()
            console.log("TFTP connection closed");
        });
    });

    server.on("error", function (error) {
        console.timeStamp()
        console.error("Error from the main TFTP socket");
        console.error(error);
    });
    server.listen()
}

initialize()
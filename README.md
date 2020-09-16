# Overview
A simple JavaScript PXE server implemented with node.js. It's built on top of the the excellent dhcp and tftp npm modules. Feedback or contributions welcome. 

See <https://tools.ietf.org/html/rfc4578> for more details on the PXE sever protocol.

# Features
* No platform specific code - should run anywhere node.js can. Can be compiled to native code with pkg
* A REST API for getting client PC details, can be disabled
* JSON configuration files
* Can configure a PXE Linux install
* Run at CLI or import with require

# Usage
## Command line
Simply call the module (run pxe-server or npx pxe-server if installed with npm) at the command line with a path to to an options file (see below) as the first and only argument. 

## JavaScript API
Start server
```js
const pxeServer = require(pxe-server);
const options = require(PATH_TO_OPTIONS_JSON_FILE);
pxeServer.initialize(options);
```
Get clients
```js
let clients = pxeServer.getClients
```

# Options
This tool is designed to load options from a JSON file as there will be rather a lot of them, though of course you could construct a JS object any way you want if calling from a program. The options.json file here is an complete, working example - you can just tweak the settings for your environment.

* apiEnabled - Required - Whether the REST API is enabled. Possible values: true or false
* configurePxeLinux - Required - Whether it should configure pxeLinux config files. Possible values: true or false
* tftpOptions - Required - Options to be passed to the tftp module. The ones used in options.json are the bare minium needed. See <https://github.com/gagle/node-tftp> for more details
* dhcpOptions - Required - Options to be passed to the dhcp module. The ones used in options.json are the bare minium needed. See <https://github.com/infusion/node-dhcp> for more details
* apiOptions - Required if API is enabled - Currently supports only host (IP to bind to, optional) and port (port to bind to, optional)
* pxeLinuxOptions - Required if PXE Linux configuration is enabled - Requires sub keys
    * location - path to pxelinux.cfg folder
    * configs - Defines PXELinux config files to create. Each key is a name of a configuration file to create. The header section defines the starting part of the file and bootOptions defines the available boot options
* bindHost - Host (IP) for the DHCP server to bind to. Optional

# Troubleshooting
TFTP request aborted or file not found errors are relatively normal errors. Please note that this module needs to be run as root on Linux or as member of the Administrators group on Windows due to the need to bind to ports below 1024 for DHCP and TFTP.

Aside from this, most problems would be due to the underlying DHCP or TFTP modules.

# Todo
* Better way of handling errors and events when invoked from a JavaScript program
* Better command-line arg handling
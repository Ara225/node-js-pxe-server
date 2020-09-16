# Overview
A simple CLI-based JavaScript PXE server implemented with node.js. Working on refactoring the code to make it more widely usable.  Feedback or contributions welcome. See (RFC4578)[https://tools.ietf.org/html/rfc4578] for more details on the PXE sever protocol.

# Features
* No platform specific code - should run anywhere node.js can. Can be compiled to native code with pkg
* A REST API for getting client PC details, can be disabled
* JSON configuration files
* Can configure a PXE Linux install
* Run at CLI or import with require
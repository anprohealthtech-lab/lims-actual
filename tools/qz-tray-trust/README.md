# LIMS QZ Tray Trust Setup

Run `install-qz-tray-trust.bat` on each Windows workstation that uses QZ Tray printing.

What it does:

- Copies `qz-certificate.pem` into the local QZ Tray install folder.
- Sets `authcert.override` in `qz-tray.properties`.
- Runs QZ Tray's whitelist command for the certificate.
- Copies `allowed.dat` to the system-wide QZ data folder when available.
- Restarts QZ Tray.

After it finishes, reload the browser and print once. If QZ Tray prompts, check
`Remember this decision` and click `Allow`.

Requirements:

- QZ Tray already installed.
- Windows administrator permission.
- The private key is not included in this folder.

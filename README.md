## TSPanelio

TSPanelio is a modern ServerQuery web panel for TeamSpeak servers.

It provides a browser-based interface for managing TeamSpeak virtual servers through ServerQuery, with a redesigned desktop and mobile-friendly UI.

![TSPanelio Preview](https://i.ibb.co/VYR4Qv0s/dark.png)

## Features

- Manage TeamSpeak virtual servers from a web interface
- Select, start, stop, create, and edit virtual servers
- Browse channels and connected clients
- Manage server groups and channel groups
- Work with client and group permissions
- Manage bans, complaints, privilege keys, and API keys
- Browse, upload, download, rename, and delete server files
- Create and restore server snapshots
- View server logs
- Mobile-friendly redesigned UI

## Installation

TSPanelio is distributed as a single executable file for each supported platform. You do not need Apache, NGINX, or another web server to run the application itself.

By default, TSPanelio starts an HTTP server on port `3000`.

```text
http://localhost:3000
```

For public HTTPS access, run TSPanelio behind a reverse proxy such as NGINX, Apache, Caddy, or Cloudflare.


## Windows

1. Download the Windows release asset:

   ```text
   tspanelio-win-x64-v1.0.X.exe
   ```

2. Start it by double-clicking the file, or run it from PowerShell:

   ```powershell
   .\tspanelio-win-x64-v1.0.X.exe
   ```

3. If Windows Firewall asks for access, allow the app on the network where you plan to use it.

4. Open the panel in your browser:

   ```text
   http://localhost:3000
   ```

## macOS

1. Download the macOS release asset:

   ```text
   tspanelio-macos-x64-v1.0.X
   ```

2. Open Terminal and go to the download folder:

   ```bash
   cd ~/Downloads
   ```

3. Make the file executable:

   ```bash
   chmod +x tspanelio-macos-x64-v1.0.X
   ```

4. Start TSPanelio:

   ```bash
   ./tspanelio-macos-x64-v1.0.X
   ```

5. Open the panel in your browser:

   ```text
   http://localhost:3000
   ```

If macOS blocks the downloaded file, allow it in System Settings → Privacy & Security, or remove the quarantine attribute:

```bash
xattr -d com.apple.quarantine ./tspanelio-macos-x64-v1.0.X
```

## Linux

1. Download the Linux release asset from GitHub Releases.

   Example:

   ```bash
   wget https://github.com/kENNYxSEVEN/tspanelio/releases/download/v1.0.X/tspanelio-linux-x64-v1.0.X
   ```

2. Make the file executable:

   ```bash
   chmod +x tspanelio-linux-x64-v1.0.X
   ```

3. Start TSPanelio:

   ```bash
   ./tspanelio-linux-x64-v1.0.X
   ```

4. Open the panel in your browser:

   ```text
   http://localhost:3000
   ```

For a server installation, running TSPanelio as a systemd service is recommended.

## Running as a systemd service on Ubuntu/Debian

Create a dedicated system user:

```bash
sudo adduser --system --no-create-home --group --disabled-password tspanelio
```

Create the application directory:

```bash
sudo mkdir -p /var/www/tspanelio
```

Copy the downloaded executable into the application directory with a stable filename:

```bash
sudo cp ./tspanelio-linux-x64-v1.0.X /var/www/tspanelio/start_tspanelio
```

Set ownership and permissions:

```bash
sudo chown -R tspanelio:tspanelio /var/www/tspanelio
sudo chmod 755 /var/www/tspanelio
sudo chmod +x /var/www/tspanelio/start_tspanelio
```

Create the service file:

```bash
sudo nano /etc/systemd/system/tspanelio.service
```

Copy the text below into a file and save it:

```ini
[Unit]
Description=TSPanelio (TeamSpeak ServerQuery Panel)
After=network.target

[Service]
Type=simple
User=tspanelio
Group=tspanelio   
WorkingDirectory=/var/www/tspanelio/
Environment=PORT=3000
ExecStart=/var/www/tspanelio/start_tspanelio
RestartSec=15
Restart=always
StandardOutput=journal
StandardError=inherit

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tspanelio
```

Check status:

```bash
sudo systemctl status tspanelio
```

View logs:

```bash
sudo journalctl -u tspanelio -f
```

## Reverse proxy and HTTPS

TSPanelio serves HTTP by default. For HTTPS, put it behind a reverse proxy. Make sure WebSocket traffic for Socket.IO is proxied correctly, otherwise the app may fall back to less efficient polling.

### NGINX example

```nginx
server {
    # Recommended: use HTTPS with Certbot.
    listen 443 ssl;
    listen [::]:443 ssl;

    # For HTTP-only setup, use these instead:
    # listen 80;
    # listen [::]:80;

    server_name tspanelio.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Let Certbot generate these paths automatically, or remove them for HTTP-only.
    ssl_certificate /etc/letsencrypt/live/tspanelio.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tspanelio.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
```

### Apache example

Enable the required modules:

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite headers ssl
sudo systemctl reload apache2
```

HTTPS virtual host with Certbot certificates:

```apache
<IfModule mod_ssl.c>
  <VirtualHost *:443>
    ServerName tspanelio.example.com
    ServerAdmin webmaster@example.com

    ProxyPreserveHost On

    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    # Reverse proxy for TSPanelio and Socket.IO polling.
    ProxyPass "/" "http://127.0.0.1:3000/"
    ProxyPassReverse "/" "http://127.0.0.1:3000/"

    # WebSocket upgrade for Socket.IO.
    RewriteEngine On
    RewriteCond %{REQUEST_URI} ^/socket.io [NC]
    RewriteCond %{QUERY_STRING} transport=websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:3000%{REQUEST_URI} [P,L]

    # Certificates.
    Include /etc/letsencrypt/options-ssl-apache.conf
    SSLCertificateFile /etc/letsencrypt/live/tspanelio.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/tspanelio.example.com/privkey.pem
  </VirtualHost>
</IfModule>
```

## Smooth migration from TS3 Manager
If you already have the legacy TS3 Manager running on your server and want to quickly migrate to TSPanelio, you can reuse the existing service and domain configuration.

This is useful when your current setup already proxies a domain, for example `https://panel.example.com` to the legacy manager binary.

Go to the directory where your current TS3 Manager binary is located:

```bash
cd /var/www/panel.example.com
```

Stop the existing service:

```bash
sudo systemctl stop ts3-manager
```

Create a backup of the old binary:
```bash
sudo mv start_ts3-manager legacy_start_ts3-manager
```

Download TSPanelio and save it using the same filename that the existing systemd service already starts:
```bash
sudo wget -O start_ts3-manager https://github.com/kENNYxSEVEN/tspanelio/releases/download/v1.0.X/tspanelio-linux-x64-v1.0.X
```

Make the new binary executable:
```bash
sudo chmod +x start_ts3-manager
```

Optionally, keep the same file owner as the previous binary:
```bash
sudo chown --reference=legacy_start_ts3-manager start_ts3-manager
```

Start the service again:
```bash
sudo systemctl start ts3-manager
```

Check the service status:
```bash
sudo systemctl status ts3-manager
```


If the legacy manager was already configured behind Nginx, Cloudflare, or another reverse proxy, no additional proxy changes should be required as long as TSPanelio listens on the same port.

### Browser cache and cookies

After migration, it is recommended to clear browser cache and site data for your TSPanelio domain, especially if you are reusing the same domain that was previously used by the legacy TS3 Manager.

## Updating

When using systemd with the stable `/var/www/tspanelio/start_tspanelio` filename:

```bash
sudo systemctl stop tspanelio
sudo cp ./tspanelio-linux-x64-v1.0.X /var/www/tspanelio/start_tspanelio
sudo chown tspanelio:tspanelio /var/www/tspanelio/start_tspanelio
sudo chmod +x /var/www/tspanelio/start_tspanelio
sudo systemctl start tspanelio
```

Then check the service:

```bash
sudo systemctl status tspanelio
```

## Runtime configuration

TSPanelio can be configured with command-line options or environment variables.

| Option | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `-p, --port` | `PORT` | `3000` | HTTP port used by the web panel |
| `-s, --secret` | `JWT_SECRET` | Random on startup | Secret used for signing/encrypting saved session data |
| `-w, --whitelist` | `WHITELIST` | Empty / allow all | Comma-separated list of TeamSpeak hosts that users are allowed to connect to |

For production, set a stable secret. If the secret changes between restarts, saved login/session data may become invalid.

Example:

```bash
./tspanelio-linux-x64-v1.0.X --port 8080 --secret "change-this-secret" --whitelist "127.0.0.1,ts.example.com"
```

Environment variable example:

```bash
PORT=8080 JWT_SECRET="change-this-secret" WHITELIST="127.0.0.1,ts.example.com" ./tspanelio-linux-x64-v1.0.X
```

## Development

Development instructions are kept separate from the user installation guide.

See [CONTRIBUTING.md](CONTRIBUTING.md).



## License and credits

TSPanelio is a modernized fork of the MIT-licensed TS3 Manager project by joni1802.

- The backend is based on the original TS3 Manager project by joni1802.
- The frontend has been completely rewritten from Vue to React, with the UI redesigned for TSPanelio.

The original MIT license notice is preserved in [LICENSE](./LICENSE).
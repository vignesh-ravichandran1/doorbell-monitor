# Setup guide: Mac and Windows

Setup is three commands, the same idea on every computer:

| Step | What it does | Mac | Windows |
|---|---|---|---|
| **1. Prepare** | Checks the computer, installs Node.js if needed, installs the app and ffmpeg, runs machine checks | `bash prepare.sh` | double-click `prepare.bat` |
| **2. Setup** | Ring login, your settings (clip folder, space for clips), optional 24/7 auto-start, then all checks | `npm run setup` | `npm run setup` |
| **3. Run** | Starts recording | `npm start` | `npm start` |

Change settings later on the clips page's **Settings** tab (protected by the PIN you choose during setup; `npm run pin` changes it). At any time, `npm run doctor` re-checks everything and tells you how to fix what's wrong.
Each step is safe to run again.

---

## Mac (testing)

**Needs:** macOS 11 (Big Sur) or newer. Any MacBook Air from 2013 onwards is fine.

1. **Get the code.** On GitHub, open the repo → green **Code** button → **Download ZIP**. Double-click the ZIP in Downloads to unzip it.
   (Or, if you use git: `git clone https://github.com/vignesh-ravichandran1/doorbell-monitor.git`)
2. **Open Terminal in that folder.** In Finder, right-click the `doorbell-monitor` folder → **Services → New Terminal at Folder**.
   (Or open Terminal and type `cd ~/Downloads/doorbell-monitor-master`.)
3. **Prepare:**
   ```
   bash prepare.sh
   ```
   If Node.js is missing it downloads the official installer from nodejs.org, checks it isn't corrupted, and asks for your **Mac password** to install it. When it ends with **Ready**, continue.
4. **Setup:**
   ```
   npm run setup
   ```
   - **Ring login:** your Ring email, password (hidden while you type) and the code Ring texts or emails you.
   - **Folder for clips:** press Enter for the default (`recordings` inside the app folder).
   - **Space for clips:** for testing, a small value like `2` GB is fine.
   - **Doorbell on battery?** Answer **n** for a wired doorbell (records rings and motion), **y** for battery (rings only).
   - **Settings page PIN:** choose 4–12 digits. It unlocks the Settings tab on the clips page.
   - **"Is this the one that will record 24/7?"** Answer **n** on the Mac while testing.
5. **Run:**
   ```
   caffeinate -i npm start
   ```
   `caffeinate` keeps the Mac awake. Keep it plugged in and the lid open, because a sleeping Mac can't record.
   You'll see `watching Front Door`. Ring the doorbell, and about 40 seconds later the clip shows up at **http://localhost:8080**.
   Stop with **Ctrl+C**.

**Problems?** Run `npm run doctor`.

---

## Windows (the always-on laptop)

**Needs:** **64-bit Windows 10 or 11.** To check, press **Win+R**, type `winver` and press Enter.
Windows 7/8 or 32-bit Windows can't run it. `prepare.bat` will tell you so. In that case, install a free light Linux such as [Linux Mint XFCE](https://linuxmint.com) and follow the Mac steps, which are the same on Linux.

1. **Get the code.** On GitHub → **Code → Download ZIP**. Right-click the ZIP → **Extract All…** and extract it somewhere permanent, e.g. `C:\doorbell-monitor` (not Downloads).
2. **Prepare:** open the folder and **double-click `prepare.bat`**.
   If Node.js is missing it downloads the official installer, verifies it, and installs it. Click **Yes** when Windows asks for permission. When it says **Ready**, close the window.
   *If Windows shows "Windows protected your PC", click **More info → Run anyway**. It's the script you just downloaded.*
3. **Open a Command Prompt in the folder:** click the File Explorer address bar, type `cmd` and press Enter.
4. **Setup:**
   ```
   npm run setup
   ```
   - **Ring login:** same as on the Mac. This laptop gets its **own** login, so don't copy files over from the Mac.
   - **Folder for clips:** your external hard disk, e.g. `E:/doorbell`. Check its drive letter in File Explorer → This PC.
   - **Settings page PIN:** choose 4–12 digits.
   - **Space for clips:** a GB amount that fits your disk, leaving some room. The oldest clips are deleted only when it's full.
   - **"Is this the one that will record 24/7?"** Answer **y**. This sets the laptop to never sleep on mains power and keep running with the lid closed, and makes the recorder start at **every boot, without anyone signing in**. Click **Yes** when Windows asks for permission.
5. **It's running now, in the background (no window).** It starts again at every boot, including Windows Update restarts and power cuts, and restarts within 10 seconds if it ever stops.
   - **Watch it:** double-click `windows\watch-log.bat`. Closing that window doesn't stop the recorder.
   - **Stop it:** `windows\stop-recorder.bat`. **Start or restart it:** `windows\start-at-boot.bat` (also sets up start at boot if it isn't already).
   - **Logs** are in the `logs` folder, one file per day. Each start notes when the laptop booted and how the previous run ended, so any gap in recording is explained.
6. **Always-on Windows settings:** double-click `windows\always-on.bat` and click **Yes**. It sets the laptop to never sleep on mains power (lid closed included), keeps the USB disk and network adapter powered, marks your home network as Private, and opens the clips page to your home Wi-Fi and Tailscale devices only.
7. **Windows Update:** Settings → Update & Security → Windows Update → **Change active hours**, and set them to when you're usually home. Updates restart outside those hours, and the recorder starts again by itself after the restart.
8. **Fixed address:** in the Bell Home Hub (`http://192.168.2.1` → **DHCP**), reserve the laptop's IP address. Then the clips page, e.g. `http://192.168.2.50:8080`, never changes. Don't forward any ports.

**Problems?** In a Command Prompt in the folder, run `npm run doctor`.

---

## Logins and environments
- The Ring login happens only in your terminal. Your email and password go straight to Ring and aren't saved. Only a login token is saved, in `.ring-token`.
- Settings live in `.env`. Both files are **never** uploaded to GitHub.
- **Each computer is its own environment** with its own login and settings. Ring replaces the token regularly, so a copy on another computer stops working. Always run `npm run setup` on each computer.
- To remove a computer's access, open the Ring app → **Control Center → Authorized Client Devices**.

## Watch from anywhere with Tailscale (free)
Tailscale links your own devices in a private network, so your iPhone can open the clips page away from home. Nothing is opened to the internet, and only devices signed in to **your** Tailscale account can connect. The Personal plan is free (3 users, 100 devices; see tailscale.com/pricing).

**On the computer that records (Mac now, Windows laptop later):**
1. Install Tailscale:
   - **Mac:** Mac App Store → search **Tailscale**, or download it from **tailscale.com/download/mac**.
   - **Windows:** download the installer from **tailscale.com/download/windows** and run it.
2. Open Tailscale. Click its icon (Mac: menu bar at the top right; Windows: system tray at the bottom right, possibly under **^**) → **Log in**, and sign in with your Google account.
3. Allow it to add a VPN configuration when asked (Mac: System Settings may ask you to approve it).
4. Click the icon again. Under **This Device** you'll see its Tailscale address, `100.x.y.z`. Click it to copy it.

**On your iPhone:**
1. App Store → install **Tailscale**.
2. Open it → sign in with the **same Google account** → **Allow** the VPN configuration.
3. Make sure the switch at the top is **on** (connected).
4. In Safari, open `http://100.x.y.z:8080` (the computer's address from step 4) → **Share → Add to Home Screen**.

**Check it works away from home:** turn off the iPhone's Wi-Fi and open the page on mobile data.
**Optional:** on the clips page → Settings → *Address of this page, for alert links*, enter `http://100.x.y.z:8080` so alert links work anywhere.

**If the page doesn't open:**
- Tailscale must be on and connected on **both** devices, signed in to the same account.
- The recorder must be running and the computer awake.
- Mac: if macOS asked "Do you want **node** to accept incoming connections?", choose **Allow**. Otherwise check System Settings → Network → Firewall.
- Windows: if Windows Firewall asks about **Node.js**, tick **Private networks** and click **Allow**.

## Troubleshooting
| Problem | What to do |
|---|---|
| Anything | `npm run doctor`: checks everything and says how to fix each problem |
| No clips appear after a ring | Run `npm run debug` and ring the bell. You should see `notification from Ring…`. If the **Ring events** check in `npm run doctor` fails, a VPN, ad blocker or firewall is blocking Google's push service (mtalk.google.com, port 5228) |
| `Ring login failed` or no `watching …` line | `npm run login` |
| Forgot the Settings PIN | `npm run pin` on the recording computer |
| Errors after updating | `npm install` (it also re-applies a needed fix to a Ring library) |

## Updating later
Download the ZIP again and replace the app files. Keep `.env`, `.ring-token` and your clips. Or run `git pull`. Then run `npm install` (or step 1, prepare, again) and restart the recorder.

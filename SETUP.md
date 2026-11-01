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
   - **Space for clips:** a GB amount that fits your disk, leaving some room. The oldest clips are deleted only when it's full.
   - **"Is this the one that will record 24/7?"** Answer **y**. This sets the laptop to never sleep on mains power and keep running with the lid closed, and it starts the recorder automatically every time you sign in.
5. **Start it now:** double-click `windows\start-doorbell.bat`, or restart the laptop. A minimised window named *Doorbell recorder* means it's running. If it ever stops, it restarts within 10 seconds.
6. **Survive power cuts (recommended):** press **Win+R**, type `netplwiz`, untick *Users must enter a user name and password*, and click OK. Windows then signs in and starts recording on its own after a reboot.
7. **Fixed address:** in the Bell Home Hub (`http://192.168.2.1` → **DHCP**), reserve the laptop's IP address. Then the clips page, e.g. `http://192.168.2.50:8080`, never changes. Don't forward any ports.

**Problems?** In a Command Prompt in the folder, run `npm run doctor`.

---

## Logins and environments
- The Ring login happens only in your terminal. Your email and password go straight to Ring and aren't saved. Only a login token is saved, in `.ring-token`.
- Settings live in `.env`. Both files are **never** uploaded to GitHub.
- **Each computer is its own environment** with its own login and settings. Ring replaces the token regularly, so a copy on another computer stops working. Always run `npm run setup` on each computer.
- To remove a computer's access, open the Ring app → **Control Center → Authorized Client Devices**.

## Updating later
Download the ZIP again and replace the app files. Keep `.env`, `.ring-token` and your clips. Or run `git pull`. Then run step 1 (prepare) again and restart the recorder.

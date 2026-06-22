OTL Automation Dashboard (GitHub Pages)
This version is designed for routine OTL Excel or CSV extracts uploaded in the browser.
Recommended GitHub upload:
`index.html`
`style.css`
`app.js`
Do not upload OTL extracts to GitHub if you do not want data in the repo. The extracts are uploaded locally in the browser when the dashboard loads.
Expected OTL columns
The app tries to detect common column names automatically. At minimum, the extract needs:
Episode Number, Lab Number, Accession Number or Request Number
Received Date / Received Time, Registration Date / Registration Time or equivalent received datetime field
Ward or Location
Test, Test Set Description, Investigation or Analyte
Optional but useful:
Hospital
Current Status
Patient Name
MRN
If your extract uses different names, edit `COLUMN_ALIASES` in `app.js`.
Behaviour
Upload one or more OTL extracts
Combines all current OTL rows
Categorises rows by ward section
Calculates time since received in lab
Buckets OTL rows by age
Allows technologists to add comments
Allows technologists to mark where the sample is or whether it has been located
Preserves comments on the next upload if the same episode/test is still on the OTL
Removes the row from the current dashboard once it is no longer present on the latest OTL extract
Keeps a TAT snapshot history in browser local storage
Allows CSV export of the current combined OTL and current view
Important limitation
Because this is GitHub Pages, persistence is stored in the browser using `localStorage`. This means:
Comments persist on the same computer/browser
Comments are not automatically shared between different computers
A shared central comment database would need a backend, Google Sheet, SharePoint list or small internal server
Suggested extract times
The app is designed for fixed OTL extract uploads, for example:
08:00
10:00
12:00
14:00
16:00
Each time, upload the latest OTL files. Samples still present keep their previous comments. Samples no longer present disappear from the current dashboard.

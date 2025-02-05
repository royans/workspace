# Gmail Email Tracker Script

This Google Apps Script periodically checks for new emails with a specific subject ("Hello World" by default) and logs the sender's obfuscated email address and the timestamp to a Google Sheet.

## Features

* **Periodic Email Checking:**  The script runs every 5 minutes (configurable) to search for new emails.
* **Subject-Based Filtering:** Only emails with the specified subject are processed.
* **Email Obfuscation:** The sender's email address is obfuscated for privacy (e.g., `f****m@example.com`).
* **Spreadsheet Logging:**  The obfuscated email and timestamp are appended to a designated Google Sheet.
* **Time-Driven Trigger:**  A trigger is used to automatically run the script at the specified interval.

## Setup and Usage

1. **Open Google Sheets:** Create a new Google Sheet or open an existing one where you want to store the email data.
2. **Open Script Editor:** In the Google Sheet, go to "Tools" > "Script editor".
3. **Copy and Paste:** Copy the provided JavaScript code and paste it into the script editor.
4. **Customize:**
    * **Sheet Name:** Change `"EmailTracking"` in the `checkForNewEmails` function to the actual name of your sheet.  If the sheet doesn't exist, the script will create it.
    * **Email Subject:** Modify `"Hello World"` in the `GmailApp.search` query to the subject of the emails you want to track.
    * **Trigger Interval:** Adjust the `everyMinutes(5)` value in the `createTrigger` function to change the script's execution frequency.
5. **Save the Script:** Save the script (File > Save). Give it a descriptive name (e.g., "EmailTracker").
6. **Authorize the Script:** Run the `createTrigger` function. You will be prompted to authorize the script to access your Gmail and Google Sheets.  **Important:** You only need to run `createTrigger` *once* to set up the recurring execution.
7. **View the Data:** The script will automatically create (if it doesn't exist) or use the sheet you specified and add new rows with the obfuscated email addresses and timestamps each time it runs and finds matching emails.

## Functions

* **`checkForNewEmails()`:** This function performs the core logic of searching for emails, obfuscating the sender's address, and adding the data to the spreadsheet.
* **`createTrigger()`:** This function sets up a time-driven trigger that runs the `checkForNewEmails` function periodically.  Run this function *once* to install the trigger.
* **`deleteAllTriggers()`:** This function deletes all triggers associated with the script.  This is useful for testing and cleanup.

## Important Notes

* The script uses the `PropertiesService` to store the timestamp of the last run, ensuring that only new emails are processed.
* The email obfuscation replaces the middle part of the email address with asterisks.
* Be mindful of the permissions you grant to the script, as it will have access to your Gmail and Google Sheets.

## Example

Let's say an email with the subject "Hello World" is sent from `test.user@example.com`. The script will add a row to your spreadsheet similar to this:

| Obfuscated Email | Timestamp                  |
|-----------------|---------------------------|
| t****r@example.com | 2024-10-27T12:00:00.000Z |

## Troubleshooting

* **Script doesn't run:** Ensure that you have authorized the script and that the trigger is set up correctly. Check the "Executions" tab in the script editor for any errors.
* **Data not appearing in the sheet:** Verify that the sheet name in the script matches the name of your sheet.
* **Email subject not found:** Double-check the email subject in the script's search query.

This README should help you set up and use the Gmail Email Tracker script effectively. If you have any questions or encounter issues, please refer to the Google Apps Script documentation or seek assistance in online forums.

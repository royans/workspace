# Google Apps Script: Uber Receipt Processor with Gemini API

This Google Apps Script automates the process of extracting key information from Uber receipt emails in your Gmail account and logging it into a Google Sheet. It leverages the Google Gemini API for data extraction and includes features to handle duplicate entries and avoid reprocessing emails.

## Features

* **Gmail Integration:** Searches your Gmail for Uber receipt emails within a configurable date range.
* **Gemini API Extraction:** Uses the Google Gemini API (`gemini-1.5-flash` by default) via `UrlFetchApp` to analyze email content and extract details like:
    * Trip Date
    * License Plate (or Driver Name as fallback)
    * Total Amount (converted to USD if necessary)
    * Trip Distance (Miles)
    * Start Destination (Short Phrase)
    * End Destination (Short Phrase)
    * PDF Receipt Link
* **Google Sheets Logging:** Records extracted data into a designated Google Sheet ("UberReceipts" by default).
* **Duplicate Handling:** Uses a unique ID based on `Date` and `Vehicle/Driver ID` (License Plate or Driver Name) to identify trips. If a newer email for the same trip ID is found (e.g., after a tip is added), it updates the existing row in the sheet.
* **Processed Message Tracking:** Maintains a separate sheet ("processedmsgs" by default) logging the SMTP `Message-ID` of emails that have been processed (either successfully logged or skipped after API analysis) to prevent redundant API calls and processing.
* **Configurable Settings:** Allows easy configuration of sheet names, date ranges, API call limits, and more via constants at the top of the script.
* **Dynamic Column Finding:** Locates required columns based on header names, making it resilient to column rearrangement.
* **Sorting:** Automatically sorts the main "UberReceipts" sheet by date (newest first) at the end of each successful run.
* **Controlled Execution:** Fetches emails in batches, processes the newest messages within a thread first, checks a minimum number of emails, and limits the number of Gemini API calls per execution run to manage usage and avoid exceeding quotas.

## Setup

1.  **Create a Google Sheet:** Create a new Google Sheet or use an existing one. This script will automatically create the necessary tabs ("UberReceipts" and "processedmsgs") if they don't exist.
2.  **Open Script Editor:** In your Google Sheet, go to `Tools` > `Script editor`.
3.  **Copy Code:** Copy the entire code from the `Code.gs` file (provided separately) and paste it into the editor, replacing any default content.
4.  **Save Script:** Click the save icon and give the script project a name (e.g., "Uber Receipt Processor").
5.  **View Manifest File:**
    * In the Script editor, go to the menu bar at the top and click `View`.
    * If you see `Show manifest file`, click it. The `appsscript.json` file will appear in the file list on the left. If you see `Hide manifest file`, it's already visible.
6.  **Edit Manifest File (OAuth Scopes):**
    * Click on the `appsscript.json` file in the left-hand file list to open it.
    * Locate the `"oauthScopes"` array within the JSON structure.
    * Ensure this array contains *at least* the following scope strings (add any that are missing):
      ```json
      "[https://www.googleapis.com/auth/gmail.readonly](https://www.googleapis.com/auth/gmail.readonly)",
      "[https://www.googleapis.com/auth/script.external_request](https://www.googleapis.com/auth/script.external_request)",
      "[https://www.googleapis.com/auth/spreadsheets.currentonly](https://www.googleapis.com/auth/spreadsheets.currentonly)",
      "[https://www.googleapis.com/auth/script.container.ui](https://www.googleapis.com/auth/script.container.ui)",
      "[https://www.googleapis.com/auth/script.scriptapp](https://www.googleapis.com/auth/script.scriptapp)"
      ```
    * Your `oauthScopes` section should look similar to this (order doesn't matter):
      ```json
        "oauthScopes": [
          "[https://www.googleapis.com/auth/gmail.readonly](https://www.googleapis.com/auth/gmail.readonly)",
          "[https://www.googleapis.com/auth/script.external_request](https://www.googleapis.com/auth/script.external_request)",
          "[https://www.googleapis.com/auth/spreadsheets.currentonly](https://www.googleapis.com/auth/spreadsheets.currentonly)",
          "[https://www.googleapis.com/auth/script.container.ui](https://www.googleapis.com/auth/script.container.ui)",
          "[https://www.googleapis.com/auth/script.scriptapp](https://www.googleapis.com/auth/script.scriptapp)"
        ]
      ```
    * **Save** the `appsscript.json` file after making changes (click the save icon).
7.  **Set Gemini API Key:**
    * Obtain an API key for the Gemini API from Google AI Studio or Google Cloud Console.
    * In the Script editor, go to `Project Settings` (gear icon on the left).
    * Scroll down to `Script Properties`.
    * Click `Edit script properties`.
    * Click `Add script property`.
    * Enter `GEMINI_API_KEY` as the Property name and paste your API key as the Value.
    * Click `Save script properties`.
8.  **Configure Constants (Optional):** Review the constants in the `--- Configuration ---` section at the top of the `Code.gs` file and adjust sheet names, date ranges (`GMAIL_SEARCH_DAYS_BACK`), API limits (`MAX_GEMINI_CALLS_PER_RUN`), etc., if needed.
9.  **Authorize Script:**
    * Select the `processUberReceipts` function from the dropdown menu next to the Debug (bug) icon.
    * Click the `Run` button.
    * You will be prompted to grant authorization. Review the requested permissions carefully (they should match the scopes added in step 6).
    * You may need to click "Advanced" and "Go to [Your Script Name] (unsafe)" if Google hasn't verified the script (since it's your own).
    * Click "Allow".
10. **Set Up Time Trigger (Recommended):**
    * Click the `Triggers` icon (alarm clock) in the left sidebar.
    * Click `+ Add Trigger`.
    * Configure the trigger:
        * Function: `processUberReceipts`
        * Deployment: `Head`
        * Event Source: `Time-driven`
        * Type: `Day timer` (or `Hour timer`, etc.)
        * Time: Select your desired time (e.g., `9pm - 10pm`).
        * Error notification: `Notify me immediately` (or as preferred).
    * Click `Save`. You may need to authorize again for trigger permissions.

## Sheets Used

* **`UberReceipts` (Default Name):**
    * Stores the main extracted trip data.
    * Columns: `Trip ID`, `Date`, `Vehicle/Driver ID`, `Amount (USD)`, `Distance (Miles)`, `Start Destination`, `End Destination`, `PDF Link`, `Processed Timestamp`.
    * Sorted by `Date` descending after each run.
* **`processedmsgs` (Default Name):**
    * Logs the SMTP `Message-ID` of every email processed by the script (successful or skipped after API call) to prevent reprocessing.
    * Columns: `SMTP Message-ID`, `Processed Timestamp`.

## Configuration Constants

The following constants at the top of `Code.gs` can be modified:

* `SPREADSHEET_NAME`: Name of the main data sheet.
* `HEADER_ROW`: Defines the exact headers and their order for the main sheet.
* `TRIP_ID_FIELD_NAME`, `VEHICLE_DRIVER_ID_FIELD_NAME`, `DATE_FIELD_NAME`: Header names used to dynamically find column indices. **Ensure these match the names in `HEADER_ROW`**.
* `PROCESSED_MSGS_SHEET_NAME`: Name of the sheet tracking processed emails.
* `PROCESSED_MSGS_HEADER_ROW`: Defines headers for the processed messages sheet.
* `PROCESSED_MSG_ID_FIELD_NAME`: Header name used to find the message ID column. **Ensure this matches the name in `PROCESSED_MSGS_HEADER_ROW`**.
* `MIN_MESSAGES_TO_CHECK`: Script tries to look at least this many recent emails.
* `MAX_GEMINI_CALLS_PER_RUN`: Limits API calls to Gemini per execution.
* `GMAIL_SEARCH_BATCH_SIZE`: Number of email threads fetched per Gmail API call.
* `GMAIL_SEARCH_DAYS_BACK`: How many days back the Gmail search query should look.
* `GEMINI_MODEL`: Which Gemini model to use (e.g., `gemini-1.5-flash`, `gemini-pro`).

## Notes & Disclaimers

* **API Costs:** Using the Google Gemini API may incur costs depending on your usage and Google Cloud/AI Studio pricing tiers. Monitor your usage.
* **Performance:** Fetching the raw content of emails to get the SMTP `Message-ID` is less performant than using Gmail's internal ID. This was implemented based on a specific debugging requirement.
* **Error Handling:** The script includes basic error handling for API calls and parsing, but complex edge cases might occur. Check the execution logs (`View` > `Executions` in the editor) for troubleshooting.
* **Rate Limits:** Google Apps Script and the Gemini API have rate limits and quotas. The script's batching and API call limits help mitigate this, but heavy usage might still encounter limits.
* **Accuracy:** Data extraction accuracy depends on the Gemini model's ability to interpret the email format, which can change over time. The prompt may need adjustments if Uber changes its receipt format significantly.

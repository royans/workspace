/**
 * Processes recent Uber receipts from Gmail, extracts details using Gemini API via UrlFetchApp,
 * and logs/updates them into a Google Sheet based on a date-(license plate OR driver name) ID.
 * Avoids reprocessing already processed emails by tracking SMTP Message-IDs in a separate sheet.
 * Retrieves Gemini API Key from Script Properties.
 * Dynamically finds column indices based on header names for robustness.
 * Fetches emails in batches (within a defined date range), processes newest first,
 * checks a minimum number, and limits API calls per run.
 * Marks messages as processed even if essential data extraction fails after API call.
 * Sorts the main sheet by date (newest first) at the end of execution.
 *
 * @OnlyCurrentDoc Limits the script to only accessing the current spreadsheet.
 * @AuthScope https://www.googleapis.com/auth/gmail.readonly Allows reading emails but not modifying them.
 * @AuthScope https://www.googleapis.com/auth/script.external_request Allows calling external APIs (like Gemini).
 * @AuthScope https://www.googleapis.com/auth/script.send_mail Allows sending mail for error notifications (optional).
 * @AuthScope https://www.googleapis.com/auth/script.scriptapp Allows managing triggers (optional).
 * @AuthScope https://www.googleapis.com/auth/script.container.ui Allows showing alerts/prompts in the UI.
 * @AuthScope https://www.googleapis.com/auth/spreadsheets.currentonly Implied by @OnlyCurrentDoc.
 */

// --- Configuration ---
const SPREADSHEET_NAME = "UberReceipts";
const HEADER_ROW = ["Trip ID", "Date", "Vehicle/Driver ID", "Amount (USD)", "Distance (Miles)", "Start Destination", "End Destination", "PDF Link", "Processed Timestamp"];
const TRIP_ID_FIELD_NAME = "Trip ID";
const VEHICLE_DRIVER_ID_FIELD_NAME = "Vehicle/Driver ID";
// ***** NEW: Define Date field name for sorting *****
const DATE_FIELD_NAME = "Date";

const PROCESSED_MSGS_SHEET_NAME = "processedmsgs";
const PROCESSED_MSGS_HEADER_ROW = ["SMTP Message-ID", "Processed Timestamp"];
const PROCESSED_MSG_ID_FIELD_NAME = "SMTP Message-ID";

// Processing Control Settings
const MIN_MESSAGES_TO_CHECK = 100; // Minimum number of recent messages to look at
const MAX_GEMINI_CALLS_PER_RUN = 5; // Max number of *new* emails to process via Gemini API per execution
const GMAIL_SEARCH_BATCH_SIZE = 20; // How many threads to fetch from Gmail at a time
const GMAIL_SEARCH_DAYS_BACK = 30; // How many days back to search for emails

// Model choice: gemini-1.5-flash is faster/cheaper, gemini-pro might be slightly better at complex extraction.
const GEMINI_MODEL = "gemini-1.5-flash";
// --- END Configuration ---

/**
 * Main function to be run manually or on a trigger.
 * Fetches emails, extracts data using Gemini API via UrlFetchApp, and updates/appends to the sheet.
 */
function processUberReceipts() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty('GEMINI_API_KEY');

  // --- Validate API Key ---
  if (!apiKey) {
    const errorMsg = "ERROR: GEMINI_API_KEY not found in Script Properties. Please set it in Project Settings > Script Properties.";
    Logger.log(errorMsg);
    SpreadsheetApp.getUi().alert(errorMsg);
    return;
  }

  try {
    // --- Get Sheets and Validate Headers ---
    const mainSheet = getOrCreateSheet_(SPREADSHEET_NAME, HEADER_ROW);
    const processedMsgsSheet = getOrCreateProcessedMsgsSheet_(PROCESSED_MSGS_SHEET_NAME, PROCESSED_MSGS_HEADER_ROW);

    // ***** UPDATED: Include DATE_FIELD_NAME in required headers for main sheet *****
    const mainSheetIndices = getHeaderIndices_(mainSheet, [TRIP_ID_FIELD_NAME, DATE_FIELD_NAME, VEHICLE_DRIVER_ID_FIELD_NAME]); // Add other essential headers if needed for validation
    const processedMsgsIndices = getHeaderIndices_(processedMsgsSheet, [PROCESSED_MSG_ID_FIELD_NAME]);

    if (!mainSheetIndices || !processedMsgsIndices) {
        Logger.log("Stopping script because required headers were not found in one or both sheets. Check previous log messages for details.");
        return;
    }
    Logger.log(`Found header indices for ${SPREADSHEET_NAME}: ${JSON.stringify(mainSheetIndices)}`);
    Logger.log(`Found header indices for ${PROCESSED_MSGS_SHEET_NAME}: ${JSON.stringify(processedMsgsIndices)}`);

    // --- Get Existing Data using dynamic indices ---
    const tripIdColumnIndex = mainSheetIndices[TRIP_ID_FIELD_NAME];
    const existingTripDataMap = getExistingTripDataMap_(mainSheet, tripIdColumnIndex);
    Logger.log(`Found ${existingTripDataMap.size} existing unique Trip IDs in ${SPREADSHEET_NAME}.`);

    const processedMsgIdColumnIndex = processedMsgsIndices[PROCESSED_MSG_ID_FIELD_NAME];
    const processedMessageIds = getProcessedMessageIds_(processedMsgsSheet, processedMsgIdColumnIndex);
    Logger.log(`Found ${processedMessageIds.size} previously processed SMTP Message-IDs in ${PROCESSED_MSGS_SHEET_NAME}.`);

    // --- Initialize Processing Loop Variables ---
    let messagesCheckedCount = 0;
    let geminiCallsMade = 0;
    let gmailOffset = 0;
    let continueProcessing = true;

    const searchStartDate = new Date();
    searchStartDate.setDate(searchStartDate.getDate() - GMAIL_SEARCH_DAYS_BACK);
    const searchDateString = Utilities.formatDate(searchStartDate, Session.getScriptTimeZone(), "yyyy/MM/dd");
    const gmailQuery = `from:@uber.com after:${searchDateString}`;
    Logger.log(`Using Gmail Query: "${gmailQuery}"`);

    Logger.log(`Starting email processing loop. Goal: Check ${MIN_MESSAGES_TO_CHECK} messages, Max API calls: ${MAX_GEMINI_CALLS_PER_RUN}.`);

    // --- Processing Loop ---
    while (continueProcessing) {
        // Check conditions before fetching next batch
        if (geminiCallsMade >= MAX_GEMINI_CALLS_PER_RUN) {
            Logger.log(`Reached max Gemini calls (${MAX_GEMINI_CALLS_PER_RUN}). Stopping.`);
            break;
        }
        if (messagesCheckedCount >= MIN_MESSAGES_TO_CHECK && (geminiCallsMade > 0 || geminiCallsMade >= MAX_GEMINI_CALLS_PER_RUN)) {
             Logger.log(`Checked minimum messages (${messagesCheckedCount}/${MIN_MESSAGES_TO_CHECK}) and processed new emails or hit API limit. Stopping.`);
             break;
        }

        Logger.log(`Fetching Gmail threads using query "${gmailQuery}". Offset: ${gmailOffset}, Batch Size: ${GMAIL_SEARCH_BATCH_SIZE}`);
        const threads = GmailApp.search(gmailQuery, gmailOffset, GMAIL_SEARCH_BATCH_SIZE);

        if (threads.length === 0) {
            Logger.log("No more Gmail threads found matching the query and offset.");
            break;
        }
        Logger.log(`Found ${threads.length} threads in this batch.`);

        // Process threads in the current batch
        for (const thread of threads) {
            if (geminiCallsMade >= MAX_GEMINI_CALLS_PER_RUN) {
                Logger.log(`Reached max Gemini calls (${MAX_GEMINI_CALLS_PER_RUN}) within batch. Stopping.`);
                continueProcessing = false; break;
            }
            if (messagesCheckedCount >= MIN_MESSAGES_TO_CHECK && (geminiCallsMade > 0 || geminiCallsMade >= MAX_GEMINI_CALLS_PER_RUN)) {
                Logger.log(`Checked minimum messages (${messagesCheckedCount}/${MIN_MESSAGES_TO_CHECK}) within batch. Stopping.`);
                continueProcessing = false; break;
            }

            const messages = thread.getMessages();
            messages.reverse(); // Process newest first

            for (const message of messages) {
                messagesCheckedCount++;
                const messageDate = message.getDate();
                const internalMessageId = message.getId(); // Keep internal ID for logging if needed
                const currentTimestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"); // Get timestamp once

                // Get Raw Content and Extract SMTP Message-ID
                let smtpMessageId = null;
                let rawContent = null;
                try {
                    rawContent = message.getRawContent();
                    smtpMessageId = extractSmtpMessageId_(rawContent);
                    if (!smtpMessageId) {
                        Logger.log(`(${messagesCheckedCount}) Could not extract SMTP Message-ID for internal ID ${internalMessageId}. Skipping.`);
                        continue;
                    }
                } catch (e) {
                    Logger.log(`(${messagesCheckedCount}) Error getting raw content or parsing SMTP ID for internal ID ${internalMessageId}: ${e}. Skipping.`);
                    continue;
                }

                // Check using SMTP Message-ID
                if (processedMessageIds.has(smtpMessageId)) { continue; }

                if (geminiCallsMade >= MAX_GEMINI_CALLS_PER_RUN) {
                    Logger.log(`Reached max Gemini calls (${MAX_GEMINI_CALLS_PER_RUN}) before processing SMTP Message-ID ${smtpMessageId}. Stopping.`);
                    continueProcessing = false; break;
                }

                Logger.log(`(${messagesCheckedCount}) Processing NEW message: "${message.getSubject()}" (SMTP_ID: ${smtpMessageId}) from ${messageDate}`);
                geminiCallsMade++; // Increment before the call

                // --- Prepare and Call Gemini API ---
                const emailBody = message.getBody();
                const emailPlainBody = message.getPlainBody();
                const prompt = `
                  Analyze this Uber receipt email content and extract the following details precisely:
                  1.  **Date of the trip:** Format as YYYY-MM-DD.
                  2.  **License Plate:** The license plate (vehicle registration number) of the car. If not available, state "Not Available".
                  3.  **Driver Name:** The first name of the driver (e.g., from "You rode with DRIVERNAME" or similar phrases). If not available, state "Not Available".
                  4.  **Total amount charged:** If the currency is not USD, convert it to USD using an approximate current exchange rate (e.g., search online for "1 EUR to USD"). State the original currency code (e.g., EUR, INR) or USD if it was originally in USD.
                  5.  **PDF Link:** The direct URL link to the PDF version of the receipt. Look for anchor tags (<a href=...>) containing ".pdf" or text like "Download PDF" or "View Receipt". If no direct PDF link is found, state "Not Available".
                  6.  **Trip Distance:** The distance of the trip in miles. If not explicitly mentioned in miles, state "Not Available" or convert if possible (e.g., from km). If distance is zero or not applicable (like Uber Eats), state "N/A".
                  7.  **Start Destination:** The starting address or location name, summarized in a short phrase (e.g., "Downtown San Jose", "123 Main St"). If not available, state "Not Available".
                  8.  **End Destination:** The ending address or location name, summarized in a short phrase (e.g., "SFO Airport", "456 Oak Ave"). If not available, state "Not Available".

                  Email Plain Text Content:
                  ---
                  ${emailPlainBody.substring(0, 6000)}
                  ---
                  Email HTML Body Snippet (for link reference):
                  ---
                  ${emailBody.substring(0, 6000)}
                  ---

                  Provide the extracted information ONLY in JSON format like this example:
                  {
                    "trip_date": "2024-12-25",
                    "license_plate": "XYZ 123",
                    "driver_name": "ALEH",
                    "total_amount_usd": "25.50",
                    "original_currency": "USD",
                    "pdf_link": "https://uber.com/receipts/download/xyz.pdf",
                    "distance_miles": "10.2",
                    "start_destination": "San Jose",
                    "end_destination": "Airport, SFO"
                  }
                  If a value isn't found, use "Not Available" or "N/A" as appropriate in the JSON string. Ensure the output is valid JSON. Do not include markdown fences like \`\`\`json or \`\`\` around the JSON output.
                `;
                const payload = { contents: [{ parts: [{ text: prompt }] }] };
                Logger.log(`(${geminiCallsMade}/${MAX_GEMINI_CALLS_PER_RUN}) Making Gemini call for SMTP_ID: ${smtpMessageId}`);
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
                const options = { method: 'POST', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };

                let response, responseCode, responseText;
                try {
                  response = UrlFetchApp.fetch(url, options);
                  responseCode = response.getResponseCode();
                  responseText = response.getContentText();
                  if (responseCode !== 200) {
                    Logger.log(`Error calling Gemini API for SMTP_ID ${smtpMessageId}. Status: ${responseCode}. Response: ${responseText}`);
                    continue; // Skip message, don't mark processed
                  }
                } catch (fetchError) {
                  Logger.log(`UrlFetchApp failed for SMTP_ID ${smtpMessageId}. Error: ${fetchError}`);
                  continue; // Skip message, don't mark processed
                }

                // --- Parse Gemini Response ---
                let extractedData, apiResponseData, jsonString = null;
                try {
                  apiResponseData = JSON.parse(responseText);
                  if (!apiResponseData.candidates?.[0]?.content?.parts?.[0]?.text) {
                     Logger.log(`Gemini response missing expected content structure for SMTP_ID ${smtpMessageId}. Finish Reason: ${apiResponseData.candidates?.[0]?.finishReason || 'N/A'}. Response: ${responseText}`);
                     markMessageAsProcessed_(processedMsgsSheet, processedMessageIds, smtpMessageId, currentTimestamp, "Invalid Gemini response structure");
                     continue; // Skip
                  }
                  let rawText = apiResponseData.candidates[0].content.parts[0].text;
                  const jsonStart = rawText.indexOf('{');
                  const jsonEnd = rawText.lastIndexOf('}');
                  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
                     jsonString = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
                     if (jsonString.indexOf('{') === -1 || jsonString.lastIndexOf('}') === -1) {
                         Logger.log(`Could not find valid JSON structure in raw text for SMTP_ID ${smtpMessageId}. Raw: ${rawText}`);
                         markMessageAsProcessed_(processedMsgsSheet, processedMessageIds, smtpMessageId, currentTimestamp, "Invalid JSON structure in Gemini text");
                         continue; // Skip
                     }
                  } else {
                     jsonString = rawText.substring(jsonStart, jsonEnd + 1).trim();
                  }
                  extractedData = JSON.parse(jsonString);
                } catch (parseError) {
                  Logger.log(`Error parsing extracted JSON string for SMTP_ID ${smtpMessageId}: ${parseError}\nString attempted: ${jsonString || 'N/A'}\nRaw Response: ${responseText}`);
                   markMessageAsProcessed_(processedMsgsSheet, processedMessageIds, smtpMessageId, currentTimestamp, "JSON parsing error");
                  continue; // Skip
                }

                // --- Determine Identifier (License Plate or Driver Name) ---
                const tripDateStr = extractedData.trip_date || Utilities.formatDate(messageDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
                let identifier = "UNKNOWN";
                let licensePlateRaw = extractedData.license_plate || "Not Available";
                let driverNameRaw = extractedData.driver_name || "Not Available";
                let skipReason = ""; // Reason for potentially skipping

                if (licensePlateRaw && typeof licensePlateRaw === 'string' && licensePlateRaw.toUpperCase() !== "NOT AVAILABLE" && licensePlateRaw.trim() !== "") {
                    identifier = licensePlateRaw.toUpperCase().trim();
                } else if (driverNameRaw && typeof driverNameRaw === 'string' && driverNameRaw.toUpperCase() !== "NOT AVAILABLE" && driverNameRaw.trim() !== "") {
                    identifier = driverNameRaw.replace(/\s+/g, '').toUpperCase();
                } else {
                    skipReason = "Missing identifier (License Plate and Driver Name)";
                    Logger.log(`Could not determine a valid License Plate or Driver Name for SMTP_ID ${smtpMessageId}. Skipping main sheet update.`);
                    markMessageAsProcessed_(processedMsgsSheet, processedMessageIds, smtpMessageId, currentTimestamp, skipReason);
                    continue; // Skip if no valid identifier found
                }

                // --- Generate Final ID ---
                if (!tripDateStr) {
                    skipReason = "Missing trip date";
                    Logger.log(`Skipping SMTP_ID ${smtpMessageId} due to missing date.`);
                    markMessageAsProcessed_(processedMsgsSheet, processedMessageIds, smtpMessageId, currentTimestamp, skipReason);
                    continue; // Cannot generate ID without date
                }
                const tripId = `${tripDateStr}-${identifier}`;

                // --- Prepare Data Row ---
                const newRowData = [
                  tripId, tripDateStr, identifier,
                  extractedData.total_amount_usd || "Not Available",
                  extractedData.distance_miles || "Not Available",
                  extractedData.start_destination || "Not Available",
                  extractedData.end_destination || "Not Available",
                  extractedData.pdf_link || "Not Available",
                  currentTimestamp // Use timestamp captured earlier
                ];

                // --- Update/Append Main Sheet ---
                let operationPerformed = false; // Flag to track if main sheet was updated/appended
                if (existingTripDataMap.has(tripId)) {
                  const rowNumber = existingTripDataMap.get(tripId);
                  try {
                    mainSheet.getRange(rowNumber, 1, 1, HEADER_ROW.length).setValues([newRowData]);
                    Logger.log(`Updated existing Trip ID: ${tripId} in row ${rowNumber} of ${SPREADSHEET_NAME}.`);
                    operationPerformed = true;
                  } catch (e) { Logger.log(`Error updating row ${rowNumber} for Trip ID ${tripId} in ${SPREADSHEET_NAME}: ${e}`); }
                } else {
                  try {
                    mainSheet.appendRow(newRowData);
                    const newRowNumber = mainSheet.getLastRow();
                    existingTripDataMap.set(tripId, newRowNumber);
                    Logger.log(`Added new Trip ID: ${tripId} to ${SPREADSHEET_NAME} in row ${newRowNumber}.`);
                    operationPerformed = true;
                  } catch (e) { Logger.log(`Error appending row for Trip ID ${tripId} to ${SPREADSHEET_NAME}: ${e}`); }
                }

                // --- Record message ID as processed ---
                if (operationPerformed) {
                    markMessageAsProcessed_(processedMsgsSheet, processedMessageIds, smtpMessageId, currentTimestamp, "Processed successfully");
                } else {
                     markMessageAsProcessed_(processedMsgsSheet, processedMessageIds, smtpMessageId, currentTimestamp, "Main sheet update/append failed");
                    Logger.log(`Main sheet operation failed for SMTP_ID ${smtpMessageId}. Marked as processed to avoid retries.`);
                }

                // Check loop conditions again after processing one message
                 if (geminiCallsMade >= MAX_GEMINI_CALLS_PER_RUN) {
                    Logger.log(`Reached max Gemini calls (${MAX_GEMINI_CALLS_PER_RUN}) after processing SMTP_ID ${smtpMessageId}. Stopping.`);
                    continueProcessing = false; break;
                }
                 if (messagesCheckedCount >= MIN_MESSAGES_TO_CHECK && geminiCallsMade > 0) {
                    Logger.log(`Checked minimum messages (${messagesCheckedCount}/${MIN_MESSAGES_TO_CHECK}) after processing new SMTP_ID ${smtpMessageId}. Stopping.`);
                    continueProcessing = false; break;
                }

            } // End message loop
            if (!continueProcessing) break; // Exit thread loop if signaled
        } // End thread loop

        // Prepare for next batch
        gmailOffset += GMAIL_SEARCH_BATCH_SIZE;

    } // End while loop

    Logger.log(`Finished processing loop. Total messages checked: ${messagesCheckedCount}. Gemini calls made: ${geminiCallsMade}.`);

    // ***** NEW: Sort the main sheet by Date (newest first) *****
    try {
        const dateColumnIndex = mainSheetIndices[DATE_FIELD_NAME];
        if (dateColumnIndex !== undefined && mainSheet.getLastRow() > 1) { // Check if sheet has data beyond header
            // Add 1 because sheet sort columns are 1-based
            const sortColumnPosition = dateColumnIndex + 1;
            Logger.log(`Sorting sheet "${SPREADSHEET_NAME}" by column ${sortColumnPosition} (Date) descending...`);
            // Sort range from row 2 down to last row
            mainSheet.getRange(2, 1, mainSheet.getLastRow() - 1, mainSheet.getLastColumn())
                     .sort({ column: sortColumnPosition, ascending: false });
            Logger.log(`Sheet "${SPREADSHEET_NAME}" sorted.`);
        } else if (dateColumnIndex === undefined) {
            Logger.log(`Could not sort sheet: "${DATE_FIELD_NAME}" column not found.`);
        } else {
            Logger.log(`Sheet "${SPREADSHEET_NAME}" has no data to sort.`);
        }
    } catch(e) {
        Logger.log(`Error sorting sheet "${SPREADSHEET_NAME}": ${e}`);
    }
    // ***** END NEW SORTING SECTION *****


  } catch (error) {
    Logger.log(`Fatal error in processUberReceipts: ${error} ${error.stack ? '\nStack: ' + error.stack : ''}`);
    // Optional: Notify on fatal error
    // MailApp.sendEmail(Session.getActiveUser().getEmail(), "Uber Receipt Script Error", `Fatal Error: ${error}\nStack: ${error.stack}`);
  }
}

// --- Helper Functions --- (No changes below this line from previous version)

/**
 * Gets the main data sheet by name, or creates it if it doesn't exist with the specified headers.
 * Handles adding new columns if the existing sheet doesn't have them.
 * @param {string} sheetName The name of the spreadsheet.
 * @param {Array<string>} requiredHeaders An array of strings for the required header row (canonical order).
 * @return {GoogleAppsScript.Spreadsheet.Sheet} The Google Sheet object.
 * @private
 */
function getOrCreateSheet_(sheetName, requiredHeaders) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log(`Created sheet: ${sheetName}`);
    sheet.appendRow(requiredHeaders);
    Logger.log(`Appended headers to ${sheetName}: ${requiredHeaders.join(', ')}`);
    sheet.setFrozenRows(1);
    const headerRange = sheet.getRange(1, 1, 1, requiredHeaders.length);
    headerRange.setFontWeight("bold");
    for (let i = 1; i <= requiredHeaders.length; i++) sheet.autoResizeColumn(i);
  } else {
    // Check/Update headers if sheet exists
    const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
    const currentHeaders = headerRange.getValues()[0];
    let headersChanged = false;
    if (currentHeaders.length < requiredHeaders.length) {
        headersChanged = true;
    } else {
        for (let i = 0; i < requiredHeaders.length; i++) {
            // Trim headers during comparison to handle potential extra whitespace
            if (currentHeaders[i].trim() !== requiredHeaders[i].trim()) {
                headersChanged = true;
                break;
            }
        }
    }
     if (currentHeaders.length > requiredHeaders.length) {
         Logger.log(`Sheet ${sheetName} has more columns (${currentHeaders.length}) than required (${requiredHeaders.length}). Headers not modified.`);
     }

    if (headersChanged) {
       Logger.log(`Headers mismatch or missing in ${sheetName}. Current: [${currentHeaders.join(', ')}], Required: [${requiredHeaders.join(', ')}]. Overwriting header row.`);
       if (requiredHeaders.length > sheet.getMaxColumns()) {
         sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredHeaders.length - sheet.getMaxColumns());
       }
       const targetHeaderRange = sheet.getRange(1, 1, 1, requiredHeaders.length);
       targetHeaderRange.setValues([requiredHeaders]); // SetValues expects a 2D array
       targetHeaderRange.setFontWeight("bold");
       sheet.setFrozenRows(1);
       // Auto-resize columns after potentially changing headers
       for (let i = 1; i <= requiredHeaders.length; i++) {
         sheet.autoResizeColumn(i);
       }
       // Clear any data beyond the new header length in the header row if overwriting reduced columns
       if (currentHeaders.length > requiredHeaders.length) {
           sheet.getRange(1, requiredHeaders.length + 1, 1, currentHeaders.length - requiredHeaders.length).clearContent();
           Logger.log(`Cleared extra header content in columns ${requiredHeaders.length + 1} to ${currentHeaders.length} in ${sheetName}.`);
       }
    }
  }
  return sheet;
}

/**
 * Gets the processed messages sheet by name, or creates it if it doesn't exist.
 * @param {string} sheetName The name of the sheet.
 * @param {Array<string>} requiredHeaders Headers for the sheet.
 * @return {GoogleAppsScript.Spreadsheet.Sheet} The Google Sheet object.
 * @private
 */
function getOrCreateProcessedMsgsSheet_(sheetName, requiredHeaders) {
  return getOrCreateSheet_(sheetName, requiredHeaders); // Reuse the same logic
}

/**
 * Reads the first row of a sheet and returns a map of header names to their 0-based column index.
 * Validates that all required headers are present.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {Array<string>} requiredHeaders An array of header names that *must* be present.
 * @return {Object|null} An object mapping header names to indices, or null if validation fails.
 * @private
 */
function getHeaderIndices_(sheet, requiredHeaders) {
    if (!sheet) {
        Logger.log("ERROR: Invalid sheet provided to getHeaderIndices_");
        return null;
    }
    try {
        const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
        const headers = headerRange.getValues()[0];
        const headerMap = {};
        let allRequiredFound = true;

        headers.forEach((header, index) => {
            if (header && typeof header.trim === 'function' && header.trim() !== "") {
                 headerMap[header.trim()] = index; // Store trimmed header name
            }
        });

        // Ensure requiredHeaders is always an array
        const headersToCheck = Array.isArray(requiredHeaders) ? requiredHeaders : [requiredHeaders];

        headersToCheck.forEach(requiredHeader => {
            // Use the canonical required header name for the check
            if (headerMap[requiredHeader] === undefined) {
                Logger.log(`ERROR: Required header "${requiredHeader}" not found in sheet "${sheet.getName()}". Found headers: [${headers.join(', ')}]`);
                allRequiredFound = false;
            }
        });

        if (!allRequiredFound) {
            return null; // Indicate failure
        }
        return headerMap;
    } catch (e) {
        Logger.log(`Error getting/parsing headers for sheet "${sheet.getName()}": ${e}`);
        return null;
    }
}


/**
 * Gets existing Trip IDs and their corresponding row numbers from the main data sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The Google Sheet object for main data.
 * @param {number} idColumnIndex The dynamically determined 0-based index of the column containing Trip IDs.
 * @return {Map<string, number>} A Map where keys are Trip IDs and values are their row numbers.
 * @private
 */
function getExistingTripDataMap_(sheet, idColumnIndex) {
  const tripDataMap = new Map();
   if (idColumnIndex === undefined || idColumnIndex === null) {
      Logger.log(`ERROR: Invalid Trip ID column index (${idColumnIndex}) provided for sheet ${sheet.getName()}. Cannot get existing trip data.`);
      return tripDataMap; // Return empty map if index is invalid
   }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return tripDataMap;

  // idColumnIndex is now 0-based, so add 1 for Range notation
  const idRange = sheet.getRange(2, idColumnIndex + 1, lastRow - 1, 1);
  const idValues = idRange.getValues();
  for (let i = 0; i < idValues.length; i++) {
    const id = idValues[i][0];
    if (id !== null && id !== undefined && String(id).trim() !== "") {
        tripDataMap.set(String(id).trim(), i + 2); // Store row number (i is 0-based relative to row 2)
    }
  }
  return tripDataMap;
}

/**
 * Gets existing SMTP Message IDs from the processed messages sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The Google Sheet object for processed messages.
 * @param {number} idColumnIndex The dynamically determined 0-based index of the column containing SMTP Message IDs.
 * @return {Set<string>} A Set containing the existing SMTP Message IDs (without angle brackets).
 * @private
 */
function getProcessedMessageIds_(sheet, idColumnIndex) {
  const idSet = new Set();
  if (idColumnIndex === undefined || idColumnIndex === null) {
      Logger.log(`ERROR: Invalid SMTP Message ID column index (${idColumnIndex}) provided for sheet ${sheet.getName()}. Cannot get processed message IDs.`);
      return idSet; // Return empty set if index is invalid
   }
  const lastRow = sheet.getLastRow();
   if (lastRow < 2) return idSet;

  // idColumnIndex is now 0-based, so add 1 for Range notation
  const idRange = sheet.getRange(2, idColumnIndex + 1, lastRow - 1, 1);
  const idValues = idRange.getValues();
  for (let i = 0; i < idValues.length; i++) {
    const id = idValues[i][0];
    // Store the ID without angle brackets if they exist
    if (id !== null && id !== undefined && String(id).trim() !== "") {
        let cleanedId = String(id).trim();
        if (cleanedId.startsWith('<') && cleanedId.endsWith('>')) {
            cleanedId = cleanedId.substring(1, cleanedId.length - 1);
        }
        idSet.add(cleanedId);
    }
  }
  return idSet;
}

/**
 * Extracts the SMTP Message-ID from the raw email content.
 * @param {string} rawContent The raw source of the email message.
 * @return {string|null} The Message-ID value (without angle brackets), or null if not found/parsed.
 * @private
 */
function extractSmtpMessageId_(rawContent) {
    if (!rawContent) return null;
    // Regex to find the Message-ID header and capture the value inside <>
    // Handles potential whitespace variations and case-insensitivity
    const match = rawContent.match(/^Message-ID:\s*<([^>]+)>/im);
    if (match && match[1]) {
        return match[1].trim(); // Return the captured group (ID without brackets)
    }
    // Fallback regex if ID is not enclosed in <> (less common)
     const fallbackMatch = rawContent.match(/^Message-ID:\s*(.+)$/im);
     if (fallbackMatch && fallbackMatch[1]) {
         return fallbackMatch[1].trim();
     }

    return null; // Not found
}


/**
 * Appends an SMTP Message ID to the processed messages sheet and adds it to the runtime set.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} processedSheet The sheet where processed IDs are logged.
 * @param {Set<string>} processedIdsSet The runtime set of processed IDs (stored without angle brackets).
 * @param {string} smtpMessageId The SMTP Message ID of the message to mark as processed (without angle brackets).
 * @param {string} timestamp The timestamp string for when it was processed/skipped.
 * @param {string} reason A brief note on why it was marked (e.g., "Processed successfully", "Missing identifier").
 * @private
 */
function markMessageAsProcessed_(processedSheet, processedIdsSet, smtpMessageId, timestamp, reason) {
    if (!smtpMessageId) {
        Logger.log("Attempted to mark message as processed with null/empty SMTP Message-ID. Skipping log.");
        return;
    }
    // Ensure we are working with the ID without angle brackets
    let cleanedId = smtpMessageId;
     if (cleanedId.startsWith('<') && cleanedId.endsWith('>')) {
        cleanedId = cleanedId.substring(1, cleanedId.length - 1);
     }

    // Check if already added in this run
    if (processedIdsSet.has(cleanedId)) {
        return;
    }
    try {
        // Append the cleaned ID (without brackets) to the sheet
        processedSheet.appendRow([cleanedId, timestamp]);
        processedIdsSet.add(cleanedId); // Add cleaned ID to the set
        Logger.log(`Marked SMTP_ID ${cleanedId} as processed in ${processedSheet.getName()}. Reason: ${reason}`);
    } catch (e) {
        Logger.log(`Error appending SMTP_ID ${cleanedId} to ${processedSheet.getName()}: ${e}`);
    }
}

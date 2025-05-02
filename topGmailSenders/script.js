/**
 * @OnlyCurrentDoc // Limits the script to only affect the current spreadsheet.
 */

// --- Configuration ---
const TARGET_SHEET_NAME = "topsenders"; // The name of the sheet to output results
const MAX_EMAILS_TO_ANALYZE = 1000; // Target number of recent emails to analyze
const FETCH_BATCH_SIZE = 500;      // Max threads to fetch per API call (cannot exceed 500)
// ---------------------

/**
 * Creates a custom menu in the spreadsheet to run the analysis.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Email Analysis')
    .addItem('Analyze Read Rates', 'analyzeEmailReadRates')
    .addToUi();
}

/**
 * Main function to analyze email read rates and output to the sheet.
 * Fetches emails in batches to avoid the 500 limit.
 * Calculates total unread emails per sender.
 * Sorts results by Total Unread descending (most unread count first).
 * Formats Sender Email as a clickable Gmail search link.
 */
function analyzeEmailReadRates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TARGET_SHEET_NAME);

  // Create the sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet(TARGET_SHEET_NAME);
    Logger.log(`Sheet "${TARGET_SHEET_NAME}" created.`);
  }

  // Clear previous results
  sheet.clearContents();
  // Set headers - Added 'Total Unread' column
  const headers = ['Sender Email', 'Sender Name', 'Total Received', 'Total Read', 'Total Unread', 'Read %'];
  sheet.appendRow(headers);
  sheet.getRange("A1:F1").setFontWeight("bold"); // Adjusted range for new header
  sheet.setFrozenRows(1); // Freeze header row

  Logger.log(`Starting email analysis for up to ${MAX_EMAILS_TO_ANALYZE} emails...`);
  SpreadsheetApp.getActiveSpreadsheet().toast(`Fetching emails in batches... This may take a moment.`, 'Status', -1);

  const senderStats = {}; // Object to store stats: { 'email@domain.com': { name: 'Sender Name', total: 0, read: 0 } }
  let totalEmailsProcessed = 0;
  let threadOffset = 0;
  let keepFetching = true;
  let batchNumber = 1;

  try {
    // Loop to fetch threads in batches
    while (keepFetching && totalEmailsProcessed < MAX_EMAILS_TO_ANALYZE) {
      Logger.log(`--- Starting Batch ${batchNumber} ---`);
      Logger.log(`Fetching threads starting from index ${threadOffset}, batch size ${FETCH_BATCH_SIZE}...`);

      const threads = GmailApp.getInboxThreads(threadOffset, FETCH_BATCH_SIZE);
      Logger.log(`Fetched ${threads.length} threads in this batch.`);

      if (threads.length === 0) {
        keepFetching = false;
        Logger.log('No more threads found in inbox.');
        break;
      }

      Logger.log(`Starting processing of messages for Batch ${batchNumber}...`);

      // Process messages within the fetched threads
      threadLoop:
      for (const thread of threads) {
        const messages = thread.getMessages();

        for (const message of messages) {
           if (!message.isInInbox()) {
               continue;
           }

           if (totalEmailsProcessed >= MAX_EMAILS_TO_ANALYZE) {
              Logger.log(`Reached target email count (${MAX_EMAILS_TO_ANALYZE}). Stopping processing.`);
              keepFetching = false;
              break threadLoop;
           }

           totalEmailsProcessed++;

           const from = message.getFrom();
           const isUnread = message.isUnread();

           let senderEmail = from;
           let senderName = '';
           const emailMatch = from.match(/<([^>]+)>/);
           if (emailMatch && emailMatch[1]) {
              senderEmail = emailMatch[1].toLowerCase().trim();
              senderName = from.substring(0, emailMatch.index).replace(/"/g, '').trim();
              if (!senderName) senderName = senderEmail.split('@')[0];
           } else {
             senderEmail = from.toLowerCase().trim();
             senderName = from; // Use the whole string if no <> found
           }

           // Ensure senderEmail is a valid string before proceeding
           if (typeof senderEmail !== 'string' || senderEmail === '') {
              Logger.log(`Skipping message due to invalid sender email: ${from}`);
              continue; // Skip this message if sender email extraction failed
           }


           if (!senderStats[senderEmail]) {
              senderStats[senderEmail] = {
                name: senderName,
                total: 0,
                read: 0
              };
           }

           senderStats[senderEmail].total++;
           if (!isUnread) {
              senderStats[senderEmail].read++;
           }

           if (totalEmailsProcessed % 100 === 0) {
               Logger.log(`Processed ${totalEmailsProcessed} emails...`);
               SpreadsheetApp.getActiveSpreadsheet().toast(`Processed ${totalEmailsProcessed} / ${MAX_EMAILS_TO_ANALYZE} emails...`, 'Status', 10);
           }
        } // End message loop
      } // End thread loop

      Logger.log(`Finished processing messages for Batch ${batchNumber}. Total emails processed so far: ${totalEmailsProcessed}`);

      threadOffset += threads.length;
      batchNumber++;
      // Utilities.sleep(200); // Optional delay

    } // End while loop

    Logger.log(`--- Batch Fetching Complete ---`);
    Logger.log(`Finished processing a total of ${totalEmailsProcessed} emails. Calculating counts, percentages and sorting...`);
    SpreadsheetApp.getActiveSpreadsheet().toast('Calculating counts, percentages and sorting...', 'Status', -1);

    // --- Calculation, Sorting, and Writing ---

    const resultsArray = [];
    for (const email in senderStats) {
      const stats = senderStats[email];
      const unreadCount = stats.total - stats.read;
      const readPercentageDecimal = stats.total > 0 ? (stats.read / stats.total) : 0;

      // *** CHANGE: Construct Gmail search URL and HYPERLINK formula ***
      const encodedEmail = encodeURIComponent(email);
      const gmailSearchUrl = `https://mail.google.com/mail/u/0/#search/from%3A${encodedEmail}`;
      // Create the formula string for the sheet. Use double quotes inside the formula.
      const emailLinkFormula = `=HYPERLINK("${gmailSearchUrl}"; "${email}")`;

      resultsArray.push([
        emailLinkFormula, // Use the formula string here instead of the plain email
        stats.name,
        stats.total,
        stats.read,
        unreadCount,
        readPercentageDecimal
      ]);
    }

    // Sort the array by Total Unread count (column index 4) in DESCENDING order
    resultsArray.sort((a, b) => b[4] - a[4]); // Sort descending by unread count

    Logger.log('Writing results to the sheet...');

    // Write data to the sheet
    if (resultsArray.length > 0) {
      // Write the array, including the HYPERLINK formulas in the first column
      sheet.getRange(2, 1, resultsArray.length, resultsArray[0].length)
           .setValues(resultsArray); // Sheets will interpret the formulas

       // Apply percentage format to the 6th column (index 5)
       sheet.getRange(2, 6, resultsArray.length, 1).setNumberFormat('0.00%');

       // Auto-resize columns
       sheet.autoResizeColumns(1, headers.length);
    }

    Logger.log('Analysis complete. Results written to sheet.');
    SpreadsheetApp.getActiveSpreadsheet().toast('Analysis Complete!', 'Success', 5);

  } catch (e) {
    Logger.log(`Error during analysis: ${e.message}\nStack: ${e.stack}`);
    SpreadsheetApp.getUi().alert(`An error occurred: ${e.message}`);
    SpreadsheetApp.getActiveSpreadsheet().toast('Error occurred during analysis.', 'Error', 10);
  }
}


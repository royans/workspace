/**
 * Periodically checks for new emails with "Hello World" in the subject.
 * Adds the sender's obfuscated email and timestamp to a spreadsheet.
 */
function checkForNewEmails() {
  // Get the spreadsheet and sheet.  Customize these!
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("EmailTracking"); // Replace with your sheet name

  if (!sheet) {
    sheet = ss.insertSheet("EmailTracking");
    sheet.appendRow(["Obfuscated Email", "Timestamp"]); // Add header row if sheet is new
  }

  // Get the last time the script ran (from PropertiesService).
  const properties = PropertiesService.getScriptProperties();

  let lastRun = Number(properties.getProperty('lastRun'));

  if (lastRun) {
    lastRun = new Date(lastRun);
    console.log(lastRun);
    if (isNaN(lastRun.getTime())) { // Check if the date is invalid
      lastRun = new Date(new Date().getTime() - 1 * 60*1000 ); // Use default if invalid
      //console.log("Invalid lastRun value found. Using default.");
    }
  } else {
    lastRun = new Date(new Date().getTime() - 1 * 60*1000 ); // Default to 1 minute ago if first run
  }

  // Get threads since the last run.
  const threads = GmailApp.search('subject:"Hello World" after:' + Math.round(lastRun.getTime()/1000));

  threads.forEach(thread => {
    const messages = thread.getMessages();
    const message = messages[messages.length - 1]; // Get the most recent message in the thread
    const sender = message.getFrom();
    const timestamp = message.getDate();

    // Obfuscate the email address.
    const emailParts = sender.match(/<([^>]+)>/); // Extract email from name <email> format
    let email = emailParts ? emailParts[1] : sender;  // use the email or the full string if can't extract
    const obfuscatedEmail = email.replace(/^(.{1})(.*)(.{1}@.*)$/, "$1****$3");

    // Append the data to the spreadsheet.
    sheet.appendRow([obfuscatedEmail, timestamp]);
  });

  // Update the last run time.
  properties.setProperty('lastRun', Math.round(new Date().getTime()));
  //console.log(Math.round(new Date().getTime()/1000));
}

/**
 * Sets up a time-driven trigger to run the checkForNewEmails function periodically.
 * Run this function ONCE to install the trigger.
 */
function createTrigger() {
  // Trigger every 5 minutes (adjust as needed).
  ScriptApp.newTrigger('checkForNewEmails')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Trigger created.');
}

/**
 * Deletes all triggers for the script.  Useful for testing/cleanup.
 */
function deleteAllTriggers() {
  const allTriggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < allTriggers.length; i++) {
    ScriptApp.deleteTrigger(allTriggers[i]);
  }
  Logger.log('All triggers deleted.');
}

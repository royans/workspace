# Gmail - Show me the top senders

This Google Apps Script reviews the most recent 1000 emails and shows the top unread email addresses. The goal is to help you find the addresses you may want to start unsubscribing or filtering to decrease the size of unread emails in your inbox.

## How to setup
* Create a new Google Sheet
* Click on "Extensions" -> "Apps Script"
* Copy the script.js into that script
* Run it, read the permissions warnings and approve if you see fit.

## How it works
* Reads 500 emails at a time, by default total of 1000 emails
* Checks if the emails were opened or not
* Calculates read %s
* Calculates the top unread emails
* Creates a tab "topsenders" in the Sheet and address the rows
    * If one exists, it will be deleted and refreshed
* It provides a deep link into Gmail, to allow you to click in and go to Gmail with the filters to show emails from a specific sender


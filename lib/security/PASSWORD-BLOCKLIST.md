# Password blocklist

`common-password-hashes.json` contains SHA-256 hashes of the 72 entries that meet
this application's existing 15–128 character length requirement in SecLists'
100,000 most common passwords. Shorter entries are already rejected by length.
This is a common-password list, not a complete or real-time breach database.
The policy also compares whole passwords against service/email-derived values
and rejects a single repeated character. It never sends passwords to a third party.

Source: https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt
Source blob: fa9a7c2e9f930c99b125aa96b7d87b3b9fcbe333
Source SHA-256: 1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b
Retrieved: 2026-09-15. Review the list during quarterly security maintenance.

MIT License

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

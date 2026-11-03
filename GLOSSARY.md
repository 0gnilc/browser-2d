# Browser 2D

Browser 2D manages local references to browser environments and independent imported cards.

## Language

**Browser**:
A local reference to a provider environment, with account and amount inputs for work.
_Avoid_: Device.

**Card**:
An independently imported record whose number, dates and security code remain raw text.
_Avoid_: Material.

**WorkTask**:
One logical execution for a Browser, processing successive Cards until stopped or exhausted.

**BrowserWorker**:
The independent execution owner for one active Browser and its WorkTask.

**DataService**:
The sole owner of application data access and committed changes.

**ProcessingId**:
A Card's stable logical processing identity across stops and renewed claims.

**ClaimToken**:
The identity of one temporary claim, replaced when the Card is claimed again.

**Operation key**:
The stable semantic identity of a processing operation, used to recognize a replay.

**Amount**:
A nonnegative exact value with two decimal places and no currency meaning. A Browser amount is an input; a Card amount is an accumulated value.

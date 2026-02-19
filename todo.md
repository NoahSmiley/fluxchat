# TODO

check to see how often app polls for new users to display + status changes, make sure its okay

make draggable area for channels in sidebar not appear in browser but instead have a small spacer there so the space between channel icon and left of section remain same or similar between app and browser

break up huge files like global.css

add min and max zoom

improve app sounds (join, leave, clicky sounds) (notification sounds are good) (some sounds seem questionably reliable, they don't always play when they should)

nickname system - users can have an alias that is their display name in the group chat. users can edit each others nickname.

add DM calls
- maybe group DMs text and voice separate from main group. these would be treated as temporary rooms. all e2ee.

when connected to voice on one device, connecting to voice on another device with the same account should disconnect the original voice connection. ensure only one active voice connection per user

channels with unread messages need a white semicircle to the left of them similar to the white bar that appears on a selected channel. same width and radius as the white bar but remove height down to circle
- there also needs to be a more prominent indicator than above, likely with a number, for unread mentions in text channels

text channels and messages should be able to be copied then pasted in a message and show up as tags that when clicked bring the user to that channel or message

more customizable profiles
- date registered
- connections (socials, platforms)
- bio

better emojis and emoji system
- soundboard sound creation menu needs update for emoji input after this

add entrance sounds

add message replies

notification settings in client settings

system for large files
- maybe have temporary file sharing for big files with expiration?
- maybe have noah approve big files?

server events
- polls
- drinking games
- movie nights
- etc

text channel (minor) events
- small polls
- temporary shared files

add pins for text channels and DMs

add reactions menu for viewing and, if admin, editing reactions

allow choosing duration time when selecting displayed statuses other than online


## CONTEXT MENUS (RIGHT CLICKING THINGS)

### text channels

- mark as read (removes message indicator)
- copy link to channel (can be pasted to link user to channel)
- mute channel
  - for amount of time
- notification settings 
  - all (default if not in category)
  - only mentions
  - none
  - default for category (if in category) (default if in category)
- edit channel
- delete channel

### voice channels

- copy link to channel (can be pasted to link user to channel (brings user to where they would be if they clicked said voice channel))
- join without entrance sound
- edit channel

### categories

- collapse/expand (recursive collapse, nonrecursive expand)
- mute category
  - for amount of time
- notification settings 
  - all (default)
  - only mentions
  - none

### messages
- add reaction
- view reactions
- edit message (if yours)
- reply
- copy message contents
- copy link to message
- copy link in message (if right click directly on link in message)
- open link in message (if right click directly on link in message)
- save image (if right click directly on image in message)
- open image (if right click directly on image in message)
- probably more for other file types and stuff

### user (avatar or username)
- profile
- DM
- call
- change nickname
- mute (prevents notifications and unread indicators from messages from this user)
- ban (if admin and selected is not admin)

### text channel chatbox
- paste
- spellcheck checkbox
- send button checkbox maybe?
# TODO


## MINOR

entrance and exit sounds

check to see how often app polls for new users to display + status changes, make sure its okay

a page for users to view the devices theyve logged into the app with
- something like what you see on github: settings > sessions
- this would potentially be part of a better solution than localStorage for storing things like soundboard volume which may be different not just per user but per device

text channels and messages should be able to be copied then pasted in a message and show up as tags that when clicked bring the user to that channel or message


## MAJOR

maybe add another section to music (in voice channel) that can play uploaded mp3s

break up huge files like global.css

improve app sounds (join, leave, clicky sounds) (notification sounds are good) (some sounds seem questionably reliable, they don't always play when they should)

nickname system - users can have an alias that is their display name in the group chat. users can edit each others nickname.

add DM calls
- maybe group DMs text and voice separate from main group. these would be treated as temporary rooms. all e2ee.

when connected to voice on one device, connecting to voice on another device with the same account should disconnect the original voice connection. ensure only one active voice connection per user

more customizable profiles
- date registered
- connections (socials, platforms)
- bio

add message replies

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

fix notification settings on channels (nested stuff)


## CONTEXT MENUS (RIGHT CLICKING THINGS)

### text channels

- copy link to channel (can be pasted to link user to channel)

### messages
- view reactions
- reply
- copy link to message
- probably more for other file types and stuff

### user (avatar or username)
- profile
- call
- change nickname
- ban (if admin and selected is not admin)

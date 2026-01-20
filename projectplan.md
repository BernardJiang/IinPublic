IinPublic app development 


A chatbot app that can repeat answers to questions that are 
publicly answered once by the users so the user can communicate with the others more efficiently.

When a user opens the app, they will automatically be assigned
 a unique id and placed in a public chatroom based on location. 
 No login is needed

 The user can see the other users within the close range and start to talk with them. 
 The user can ask a single question to a single user manualy or 
 use the chatbot to start thousands of talks to the thousands of other users automatically.

 The user can answer a single questions from the other user manualy 
 or use the chatbot to answer a series of questions that were answered before.

 Each question has mandatory and optional answers.
 The mandatory answers are "Ignore", Optional answers are "No" and "Yes", or "True" or "False".
 For any reason, the user can ignore the question and not answer it.
 For each optional question, the user can select "auto" or "manual" attributes. 
 The "auto" attribute means that the answer is public to all users and can be repeated by the chatbot.
 The "manual" attribute means that the answer is private to the user who asked the question and cannot be repeated by the chatbot. 
 Once a question is answered by the user with an "auto" attribute, the answer is repeated by the chatbot when the same question is asked
 by another user or chatbot. 

The chatbot can also remind its user the previous manual answer to the same question, but not answer the question for the user.

A series of questions can be linked together and form a talk. The talk are tree structured. From the top, each question is followed by 2 or more answers. 
Each answer can trigger the next question.

The simplest form of a talk is a linear talk. Each question has only one answer that triggers the next question, the other answers are ignored and the talk is terminated. 
This is the most common form of a talk. It is useful to make friends who answer all questions that you expect. 
And filter out the users who do not answer all questions that you expect.

A more complex talk is a tree talk. Each question has 2 or more answers. 
Each answer can trigger the next question. The next question can have 2 or more answers. 

The last question of a talk is the final question of which all answers don't trigger the next 
question. Instead, it prompts the users the final answer.  You can define how to respond to each final answer. 
It might find a match for the user based on the answers, or ignore the entire talk.

When a user answers a talk with multiple questions, the chatbot will automatically answer all questions that have been answered before.
the user only have to answer the new questions that never been answered before or been answered with "manual" attribute.

The app should have a chat interface that allows users to answer questions and talk with the other users and their chatbots.
The app should have a another chat interface that allows users to ask questions and talk with the other users and their chatbots. 

The app should have a way to copy/save/re-use a talk from the other users and their chatbots.
The app should have a editor interface that allows users to edit their questions and answers and create talks.

The app doesn't support group chat. All chat are one-on-one chat. Only auto answers are repeated by chatbot to the other user.

The app should use gun.js for real time database. 
It should maintain a list of questions and answers in the database. This is the basic database for the app. 
It should maintain a list of talks that the user send to the chatroom for the others to 
answer periodically, which is more efficient than single question/answer 
It should maintain a list of users in the database with some statistics of interactions, such as 
the number of questions answered, the number of talks sent, the number of matches found, etc. The user can edit these users' profile, such as nickname, 
relationship with the user, category of the users, etc.

 
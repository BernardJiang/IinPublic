import xs, { Listener, Stream } from 'xstream'
import Gun from 'gun/gun'
import Sea from 'gun/sea'
import path from 'gun/lib/path'
import { promOnce, promPut, promSet, promOn } from 'gun/lib/path'
import open from 'gun/lib/open'
import 'gun/lib/open'
import 'gun/lib/unset'
import _ from 'lodash'
// import as from 'gun/as'
// import nts from 'gun/nts'

import chatAI from './ChatAI'
// import chatAI from './lib/chatAI'

const KUserList = 'userlist2'
const KSignStatus = 'signstatus'
const KChat = 'chat'
const KAttributes = 'attributes'

/*
   class Entity {
       identity,
       attributes, //a list of Q/A that describes the person's attributes
       location,
       contacts, //a list of other Entities/persons that this has contact with.
          {
              nickname,
              description,
              relation tag: fan, star, friends, family, colleague, acquaintance, stranger
          }
       chats, //one-on-one talk
       {
           from self to others;
           from others to self;
       }
       topics, //a chain of Q/A that defines an automatic topic.
       {
           dating,
           making new friends of common interests.
           buy
           sell
           shoppingList
           business review
           opinions

       }
       chatAI{
           search for person to talk with. by distance, by max number of contacts.

           once a person X is found,

           Ask(){
              start to talk to X with a list of topic.
                each topic can have a list of question, seeking answer from X.
                if X doesn't have an answer to my question, leave the question and move on
                if X has the answer, then follow the logic of topic to finish the question.

           }
           Answer(){
              also, answer the question from X.
           }

       }
   }

In async function () {
Var bob = gun.get(‘people).get(‘bob’).promOnce();
Console.log((await bob).data)
}
*/
/*
  question?
  answer.
  question?answer.
  question?answer;option2;...;lastoption.
  ignore the rest.
*/

const PatternQuestion = /^([^?]+)(\x3F)+$/
const PatternAnswer = /^([^.]+)(\x2E)+$/
const PatternQuestionWithAnswer = /((.*?)(\x3F)+)((.*?)(\x2E)+$)/
const PatternQuestionWithOptions = /((.*?)(\x3F)+)((.*)(\x3B)+)*((.*?)(\x2E)+$)/

export class Entity {
  constructor(gun) {

    // localStorage.clear();

    this.gun = gun
    this.sign = this.gun.get('sign')
    this.user = this.gun.user()
    this.userAttributes = null; // it's null before sign in. this.user.get('attributes')
    this.userTalks = null;
    this.userSettings = null; // it's null before sign in. this.user.get('settings')
    this.chat = this.gun.get('chat')
    this.userlist = this.gun.get('userlist')
    // // this.userlist.on(this.cbNewUser);
    this.msgs = {}
    this.attrs = []
    this.stageName = ''
    this.userNameList = []
    this.chatAI = new chatAI(this.gun);
  }

  // cbNewUser(newuser) {
  //     console.log("New user is on", newuser);

  // }
  // public chat() { return this.chat; }
  // public user() { return this.user; }
  static time() {
    var t = Gun.time.is();
    // console.log("chat", t);
    return t;
  }
  static random() {
    return Gun.text.random(4);
  }

  isUserOnline() {
    if (this.user.is) {
      console.log('You are logged in');
    } else {
      console.log('You are not logged in');
    }
    return this.user.is
  }

  getStageName() {
    return this.stageName;
  }

  create(stageName, password) {
    return this.user.create(stageName, password, ack => {
      if (ack.err) {
        console.log('create user failed', ack.err);
        // return;
      } else {
        // console.log('create user OK');
      }
    });
  }
  // listentouser(cb) {
  //     this.userlist.on(data => {
  //         this.usercount(cb)
  //     });
  // }
  getUserList() {
    const self = this
    return xs.create({
      start(listener) {
        // console.log('shallow: ' + self.path)
        self.gun.get(KUserList).on((state) => {
          // console.log('shallow: ' + self.path + ". state= ")
          // console.log(state)
          let newlist = []
          for (let key in state) {
            let row = state[key];
            if (row === null || key === '_')
              continue;
            // console.log( "key=", key, ". row=", row)
            newlist.push(key)
          }
          // console.log("newlist = ", newlist);
          listener.next({ userlist: newlist })
        })
      },
      stop() {
      },
    })
  }

  getAttributeList() {
    const self = this
    self.attrs = []
    return xs.create({
      start(listener) {
        // console.log('create getAttributeList: user=' + self.gun.user())
        self.gun.get(KAttributes).map().on((newlist => (state, id) => {
          // console.log('attribute. state= ', state)
          // console.log('attribute. id= ', id)
          // if(state.when + 10000000 > Entity.time()){
          // let msg= {message: state.message, when: state.when, answer: state.answer}
          if (state === null)
            delete newlist[id]
          else
            newlist[state.question] = state
          // console.log('newlist', newlist)
          self.attrs = Object.values(newlist).sort((a, b) => (a.when < b.when) ? 1 : -1)
          listener.next({ attributeList: self.attrs })
          // }
        })({}))
      },

      stop() {
      },
    })
  }

  getSignStatus() {
    const self = this
    return xs.create({
      start(listener) {
        // console.log('shallow: ' + self.path)
        self.gun.get(KSignStatus).on((state) => {
          // console.log('shallow: ' + self.path + ". state= ")
          // console.log(state)
          let auth = false
          let name = ''
          for (let key in state) {
            let row = state[key];
            if (key === 'stageName')
              name = row
            if (key === 'signin')
              auth = row
            // console.log("key=", key, ". row=", row)
          }
          let newstatus = { authenticated: auth, stageName: name }
          // console.log("newstatus = ", newstatus);
          listener.next(newstatus)
        })
      },
      stop() {
      },
    })
  }

  getChat() {
    const self = this
    return xs.create({
      start(listener) {
        // console.log('shallow: ' + self.path)
        self.gun.get(KChat).map().on((newlist => (state, id) => {
          // console.log('id', id)
          // console.log('. state= ', state)
          // let newlist = []
          // newlist.push(state)
          // console.log("state.when = ", state.when, Entity.time());
          if (state.when + 10000000 > Entity.time()) {
            // let msg = { bot: state.bot, message: state.message, when: state.when, stageName: state.stageName }
            state.isMyself = state.stageName == self.stageName 
            // console.log("isMyself =" , state.isMyself, state.stageName, self.stageName)
            if (newlist.length != 0) {
              let lastone = newlist[newlist.length - 1]
              if (!_.isEqual(lastone, state))
                newlist.push(state)
            } else
              newlist.push(state)

            // console.log('msg', msg)
            listener.next(newlist)
          }
        })([]))
      },
      stop() {
      },
    })
  }


  onSignChange = UpdateUISign => {
    this.cbUpdateUISign = UpdateUISign
    console.log("Registered cbUpdateUISign ", UpdateUISign)
  }

  leave(stageName, password) {
    this.user.leave()
    var user = this.user.get(stageName)
    this.userlist.unset(user)
    this.userAttributes = null
    this.userTalks = null
    this.userSettings = null
    this.stageName = ""
    this.chatAI.setSelf("")
    this.cbUpdateUISign && this.cbUpdateUISign({ authenticated: false })
  }

  auth(stageName, password, authenticated) {
    this.stageName = stageName;
    this.myself = "";
    if (authenticated == false) {
      const self = this.gun
      this.user.auth(stageName, password, ack => {
        // console.log('auth err', ack.err);
        if (ack.err) {
          // console.log('auth err', ack.err);
        } else {
          self.get(KSignStatus).put({ stageName: stageName, signin: true })
          this.myself = self.get(stageName).put({ stageName: stageName })
          // console.log('auth OK, set userlist myself=', myself);
          self.get(KUserList).set(this.myself)
          this.userAttributes = this.user.get(KAttributes)
          this.chatAI.setSelf(this.myself)
          this.chatAI.setStageName(stageName)
        }
      })
    } else {
      const myself = this.gun.get(stageName)
      // console.log("sign out !!! myself= ", myself )
      this.gun.get(KUserList).unset(myself)
      this.gun.get(KSignStatus).put({ stageName: stageName, signin: false })
      this.user.leave()
      this.userAttributes = null
      this.chatAI.setSelf("")
      this.chatAI.setStageName("")
    }

    // this.user.auth(stageName, password, ack => {
    //     if (ack.err) {
    //         console.log('err', ack.err);
    //         this.cbUpdateUISign && this.cbUpdateUISign({authenticated: false})
    //         return;
    //     }
    //     this.myself = this.user.get(stageName).put({
    //         stageName: stageName
    //     })
    //     this.userlist.set(this.myself)
    //     this.userAttributes = this.user.get('Attributes')
    //     this.userSettings = this.user.get('Settings')
    //     this.stageName = stageName;
    //     this.chatAI.setSelf(this.myself)

    //     if(this.cbUpdateUISign){
    //         console.log("calling userlist open");
    //         this.userlist.open((list) => {
    //             console.log("Begin of userlist callback list =", list);
    //             const reducer = (newList, key) => {
    //                 if (list[key] && !!Object.keys(list[key]).length && list[key].stageName) {
    //                     return [...newList, {
    //                         text: list[key].stageName,
    //                         key
    //                     }];
    //                 } else {
    //                     return newList;
    //                 };
    //             }
    //             const keylist = Object.keys(list);
    //             if (keylist === undefined) {
    //                 return;
    //             }
    //             this.userNameList = keylist.reduce(reducer, []);
    //             console.log("Will call setState from userlist callback this.userNameList =", this.userNameList);
    //             this.cbUpdateUISign && this.cbUpdateUISign({
    //                 userlist: this.userNameList || [],
    //                 mencnt :  this.userNameList.length,
    //                 authenticated: true
    //             });
    //             console.log("End of userlist callback");
    //         });
    //         console.log("end of calling userlist open");

    //     } else{
    //             //should unregister callback here.
    //     }
    //     //If these callbacks are available, then call to notify them.
    //     this.cbUpdateUIChatBot && this.cbUpdateUIChatBot({stageName});
    //     this.cbUpdateUIAttributes && this.cbUpdateUIAttributes({})
    //     this.cbUpdateUITalks && this.cbUpdateUITalks({})
    //     this.cbUpdateUISettings  &&  this.cbUpdateUISettings({stageName})
    // });
  }

  // usercount(cb) {
  //     this.onSignChange(cb);
  // }

  sendMessage(userinput) {

    var msg = this.chatAI.parsemsg(userinput)

    var chatmsg = { ...msg, 
      stageName: this.stageName,
      when: Entity.time(),
      where: "empty",
      bot: false,
      // uplink: "empty",
      // downlink: "empty"
    }
    console.log("Entity Send chat message=", chatmsg)
    var gmsg = this.chat.set(chatmsg);
    if (gmsg == undefined) {
      console.log("err", gmsg)
    }

    // const myself = this.gun.get(msg.stageName)

    // gmsg.path('author').put(myself);
    // myself.path('post').set(gmsg);
    if(this.chat.msgType != "unknown"){
      this.chatAI.processAttribute(gmsg);
      this.chatAI.processRespond(msg)

    }

  }

  sendAnswer(userinput) {
    console.log("In sendAnswer", userinput)

    var chatmsg = { 
      stageName: this.stageName,
      when: Entity.time(),
      where: "empty",
      bot: false,
      answer: userinput["op" + userinput.ButtonIndex]
    }
    var gmsg = this.chat.set(chatmsg);
    if(gmsg == undefined) {
      console.log("err", gmsg)
    }
    
  }

  // //prepare data for UI.
  // onChatMessage(cbUpdateUIChat) {
  //     // console.log('Entity onChatMessage', 'entered')
  //     const tmpState = {}
  //     var chat = this.chat
  //     var chatAI = this.chatAI;
  //     this.cbUpdateUIChat = cbUpdateUIChat
  //     this.chat.map().once(msg => {
  //         tmpState[msg.key] = msg
  //         // console.log('Entity onChatMessage', key)
  //         // var date = new Date(msg.when).toLocaleString().toLowerCase()
  //         console.log('Entity onChatMessage', " key=" + msg.key + " who=" + msg.stageName + ". msg=" + msg.message + ". bot=" + msg.bot)
  //         // console.log("local msgs len=", Object.keys(this.msgs).length)
  //         // console.log("tmpState len=", Object.keys(tmpState).length)
  //         this.msgs = Object.assign({}, this.msgs, tmpState)
  //         cbUpdateUIChat({
  //             msgs: this.msgs
  //         })

  //         msg && chatAI.processRespond(msg)
  //     })
  // }

  //prepare data for UI.
  onChatBotMessage(cbUpdateUIChatBot) {
    //   console.log('Entity onChatBotMessage', 'entered')
    const tmpState = {}
    var chat = this.chat
    var chatAI = this.chatAI;
    this.cbUpdateUIChatBot = cbUpdateUIChatBot
    var counter = 0;
    this.chat.map().once(async (msg) => {
      // console.log('Entity counter=', counter++ )
      // console.log('Entity msg=', msg )
      if (msg.message === undefined && msg.options === undefined) {
        console.log("wrong message", msg)
        return
      }
      //regular message
      tmpState[msg._['#']] = msg
      var author = await this.userlist.get(msg.author).then();
      // console.log('Entity n=', author )
      if (author == undefined) {
        // console.log('Entity onChatBotMessage n name=', "unknown" )
        tmpState[msg._['#']].stageName = "unknown"
      } else {
        // console.log('Entity onChatBotMessage n name=', author.stageName )
        tmpState[msg._['#']].stageName = author.stageName
      }

      // console.log("msg.options=", msg.options)
      if (msg.options) {  //this is an option 
        var opts = {}
        var optarr = []
        opts = await this.gun.get(msg.options['#']).then();
        // console.log("opts=", opts)
        // Object.keys(opts).map( (key, idx) => {
        //     console.log("option  ==== key", key)
        //     console.log("option ===== idx" , idx)
        //     if(key === '_')
        //         return
        //     var opt = this.gun.get(opts[key]['#']).then()
        //     console.log("option now =", opt)
        //     optarr.push(opt)
        // })
        // var op0 = await this.gun.get(opts.op0['#']).then();
        // var op1 = await this.gun.get(opts.op1['#']).then();
        var self = this.gun;
        if (opts) {

          Object.keys(opts).forEach(async function (key) {
            if (key.startsWith("op")) {
              // console.log('key= '+key, opts[key])
              var currop = await self.get(opts[key]['#']).then();
              optarr.push(currop)
            }
          })
        }
        // console.log("option all =", optarr)
        // msg.options = optarr
        // msg = Object.assign({}, ...msg, {options: optarr})
        // tmpState[msg._['#']].options = optarr
        tmpState[msg._['#']] = await Object.assign(tmpState[msg._['#']], { options: optarr })

        // var opt1 = await this.gun.get(opts.idx).then();
        // console.log("options1=", opt1)
        // var optionobj = await this.gun.get(msg._['#']).open().then(); 
        // console.log("open nested object", optionobj)
      }

      //   this.userlist.get(msg.author)
      // console.log('Entity onChatMessage', key)
      // var date = new Date(msg.when).toLocaleString().toLowerCase()
      //   console.log('Entity onChatBotMessage', " key .#=" + msg._['#'] + " who=" + msg.stageName + ". msg=" + msg.message + ". bot=" + msg.bot)
      // console.log("local msgs len=", Object.keys(this.msgs).length)
      //   console.log("tmpState =", tmpState[msg._['#']])
      //   if(tmpState[msg._['#']].options){
      //     console.log("tmpState options total=", Object.keys(tmpState[msg._['#']].options).length)
      //   }else{
      //       console.log("No options.")
      //   }
      this.msgs = Object.assign({}, this.msgs, tmpState)
      // console.log("Entity: all msgs=", this.msgs)
      cbUpdateUIChatBot({
        msgs: this.msgs
      })

      chatAI.processRespond(msg)
    })
  }

  onAttributesChange(cbUpdateUIAttributes) {
    // console.log('Entity onAttributesChange', 'entered')
    this.cbUpdateUIAttributes = cbUpdateUIAttributes;
    if (this.cbUpdateUIAttributes) {
      const tmpState = {}
      if (this.userAttributes == null)
        return;
      this.userAttributes.map().on((msg) => {
        tmpState[msg.message] = msg
        // console.log('Entity onAttributesChange : ' + key + ". Q=" + msg.message + ". A="+ msg.answer)
        // console.log('Entity onAttributesChange', msg)
        // console.log("local msgs len=", Object.keys(this.msgs).length)
        // console.log("tmpState len=", Object.keys(tmpState).length)
        this.attrs = Object.assign({}, this.attrs, tmpState)
        cbUpdateUIAttributes({
          stageName: this.stageName,
          msgs: this.attrs
        })
      })

    } else {
      const tmpState = {}
      if (this.userAttributes == null)
        return;
      this.userAttributes.map().off()

    }
  }

  onTalksChange(cbUpdateUITalks) {
    console.log('Entity onTalksChange', 'entered')
    this.cbUpdateUITalks = cbUpdateUITalks;
    const tmpState = {}
    if (this.userTalks == null)
      return;
    this.userTalks.map().on((msg) => {
      tmpState[msg.message] = msg
      // console.log('Entity onAttributesChange : ' + key + ". Q=" + msg.message + ". A="+ msg.answer)
      // console.log('Entity onAttributesChange', msg)
      // console.log("local msgs len=", Object.keys(this.msgs).length)
      // console.log("tmpState len=", Object.keys(tmpState).length)
      this.talks = Object.assign({}, this.talks, tmpState)
      cbUpdateUITalks({
        stageName: this.stageName,
        msgs: this.talks
      })
    })
  }

  onSettingsChange(cbUpdateUISettings) {
    // console.log('Entity onSettingsChange', 'entered')
    this.cbUpdateUISettings = cbUpdateUISettings;
    const tmpState = {}
    if (this.userSettings == null)
      return;
    this.userSettings.map().on((msg, key) => {
      tmpState[key] = msg
      //  console.log('Entity onSettingsChange : ' + this.stageName)
      //  console.log('Entity onSettingsChange', ". key=" + key + ". msg = " + msg  )
      // console.log("local msgs len=", Object.keys(this.msgs).length)
      // console.log("tmpState len=", Object.keys(tmpState).length)
      this.attrs = Object.assign({}, this.attrs, tmpState)
      cbUpdateUISettings({
        stageName: this.stageName,
        msgs: this.attrs
      })
    })
  }

  changeSettings(key, msg) {
    if (this.userSettings == null)
      return;
    this.userSettings.get(key).put(msg);
    // console.log('Entity changeSettings : ' +key + ". msg=" + msg)
  }

  updateAttribute(newattr) {
    if (this.userAttributes === null)
      return
    console.log("Attributes", 'question: ' + newattr.question);
    var msg = this.chatAI.parsemsg(newattr.question)
    msg.when = Entity.time()
    if (msg.msgType.startsWith('question')) {
      this.userAttributes && this.userAttributes.get(msg.question).put(msg, function (ack) {
        console.log("save attribute", ack)
      });
    }
  }

  deleteAttribute(option) {
    const self = this
    const pos = option.pos
    const msg = self.attrs[pos]
    console.log("about to delete ", msg)

    if (this.userAttributes === null)
      return
      //this.userAttributes = this.gun.get(KAttributes)

    this.userAttributes && this.userAttributes.get(msg.question).put(null, function (ack) {
      console.log("delete an attribute", ack)
    });

  }

}

export function makeEntityDriver(opts) {
  // console.log('gun opts.root--------------------------------------')
  // console.log(opts)
  // console.log('-----------------------------------------------------')

  const entity = new Entity(new Gun(opts.peers))

  return function entityDriver(sink) {
    sink.addListener({
      next: (command) => {
        // console.log('command is not a function!!!')
        // console.log(command)
        if (command === undefined || !('action' in command))
          return

        switch (command.action) {
          case 'signup':
            // console.log('command is sign up!!!')
            entity.create(command.stageName, command.password);
            break;
          case 'signin':
            entity.auth(command.stageName, command.password, command.authenticated);
            break;
          case 'btnsend':
            entity.sendMessage(command.userinput);
            break;
          case 'btndel':
              console.log('Chatbot delete a question: ', command)
              // entity.deleteAttribute({ pos: command.pos })
          break;
          case 'btnAns':
              console.log('Chatbot answer a question: ', command)
              console.log('Chatbot myself: ', entity.stageName)
              entity.sendAnswer( command )
          break;
          case 'btnattributesubmit':
            console.log('attribute sent : ', command)
            entity.updateAttribute({ question: command.question, answer: command.answer })
            break;
          case 'btnattrdel':
            console.log('attribute delete an attribute: ', command)
            entity.deleteAttribute({ pos: command.pos })
            break;
          default:
            console.log('command is not defined!!!', command)
          break;

        }
      }
    })

    return entity
  }
}


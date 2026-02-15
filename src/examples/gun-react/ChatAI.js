import Gun from 'gun/gun'
import Sea from 'gun/sea'
import path from 'gun/lib/path'
import 'gun/lib/open'
import 'gun/lib/unset'

// ? 0x3F; . 0x2E; ; 0x3B; ! 0x21
const PatternQuestion = /^([^?]+)(\x3F)+$/
const PatternAnswer = /^([^.]+)(\x2E)+$/
const PatternQuestionWithAnswer = /((.*?)(\x3F)+)((.*?)(\x2E)+$)/
const PatternQuestionWithOptions = /((.*?)(\x3F)+)((.*)(\x3B)+)*((.*?)(\x2E)+$)/

const KAttributes = 'attributes'

export default class ChatAI {
    constructor(gun) {
        this.gun = gun

        // this.userAttributes = userAttributes
        // this.stageName = ''
        this.myself = ''
    }
    setStageName(stageName) {
        this.stageName = stageName
    }

    setSelf(myself) {
        // this should be replaced with real id. stageName can be changed.
        // this.stageName = stageName
        this.myself = myself
    }

    parsemsg(userinput) {
        console.log('user input: ' + userinput);
        var msg = { question: "", answer: "", oplen: 0, message: userinput, msgType: 'unknown' }
        var optionsarray = []
        var res = PatternQuestionWithOptions.exec(userinput) // +"?"+ newattr.answer + ";" + newattr.options + ".")
        console.log("parsed: ", res);
        if (res !== null) {
            //0: whole match string.
            //1: question with ?
            //2: question without ?
            //3: ? 
            //4: options except last option
            //5: options without last ;
            //6: ;
            //7: last option
            //8: last option without .
            //9: .
            msg.question = res[2];  //question without ?
            if (res[4] !== undefined) { //have at least one option
                optionsarray = res[5].split(';')
                optionsarray.push(res[8])
                //The first option is my own answer if more than one option.
                msg.answer = optionsarray[0]
                msg.oplen = optionsarray.length
                msg.msgType = 'question_with_options'
                optionsarray.forEach((opt, idx) => {
                    // console.log("Opt opt=", opt)
                    // console.log("Opt idx=", idx)
                    // msg.options = Object.assign({}, msg.options, {['op' + idx]: {value: "op"+idx, label: opt, trigger: '6'}}) 
                    msg['op' + idx] = opt
                    msg['tr' + idx] = 6
                })
            } else {
                //just answer.
                msg.answer = res[8]
                msg.oplen = 0
                msg.msgType = 'question_with_answer'
            }
        } else {

            var resques = PatternQuestion.exec(userinput) // question +"?"
            console.log("resques=", resques);
            if (resques !== null) {
                msg.question = resques[1];
                msg.msgType = 'question'
            } else {
                var resans = PatternAnswer.exec(userinput) // answer +"."
                console.log("resans=", resans);
                if (resans !== null) {
                    msg.answer = resans[1];
                    msg.msgType = 'answer'
                }
            }
        }

        return msg
    }

    processAttribute(msg) {  //process message of self. This process handles attributes process. It doesn't respond to questions.
        console.log("In chatAI processAttribute() msg=", msg)
        var userself = this.gun.user()
        if(!userself)
            return

        var userAttributes = this.gun.get(KAttributes)
        if (!userAttributes) //validate attributes.
            return

        msg.once(function (data) {
            //If the message is a question/answer/options, then save it under the question.
            //If the message is a question, then save it if not yet saved.
            //If the message is an answer, then save it under the lastquestion.
            console.log("data =", data)
            if (data == undefined || data._ == undefined)
                return

            switch(data.msgType){
                case 'question':
                    userself.get('lastquestion').put({
                        question: data.question
                    });
                    var lq = userAttributes.get(data.question)
                    if(lq){
                        //do nothing for now.
                        break;
                    }
                case 'question_with_answer':
                case 'question_with_options':
                    userAttributes.get(data.question).put(data, function (ack) {
                        console.log("save attribute", ack)
                    });
                    break;
                case 'answer':
                    var lq = userself.get('lastquestion')
                    if (lq) {
                        lq.once(function (ques) {
                            // console.log("get lastquestion object", data.message)
                            ques && userAttributes.get(ques.question).put({
                                question: ques.question,
                                answer: data.answer
                            })
                            userself.get('lastquestion').put(null);
                        })
                    } else {
                        //ignore answer without a question.
                        console.log("Ignore an answer.", data)
                    }
                        break;
                default:
                    console.log("something went wrong!!!, not a valid msg type");
            }
        })

    }



    processRespond(msg) { // respond the message from others and self.

        console.log("In chatAI process() msg=", msg)

        var chat = this.gun.get('chat')
        this.user = this.gun.user()

        if (!this.user.is)  //if not log in.
            return

        this.userAttributes = this.gun.get(KAttributes)
        if (!this.userAttributes)  //if no userAttributes
            return
        // var stageName = this.stageName
        if (msg.msgType != 'question')
            return

        var ans = this.userAttributes.get(msg.question)
        console.log("ans:", ans);
        if (!ans)
            return //answer is null, then ignore it.

        var user = this.user
        var userAttributes = this.userAttributes
        var myself = this.user
        var thisChatAI = this

        ans.once(function (data) {
            console.log("got the answer =", data)
            if (data == undefined || data._ == undefined)
                return
            if (!("answer" in data) || data.answer == "")
                return //means question exists without an answer.
            var answer = {
                stageName: thisChatAI.stageName,
                when: Gun.time.is(),
                answer: data.answer,
                bot: true,
            }

            // console.log("ChatAI msg", msg);
            console.log("ChatAI answer", answer);

            var gAns = chat.set(answer);

            // var soul = msg._['#'];
            // var gQuestion = chat.get(soul);

            // console.log("ChatAI question soul", soul)
            // console.log("ChatAI answer soul ", gAns._.get);  //why is this undefined?

            // gQuestion.get('downlink').put(gAns);   //link question to answer.
            // gAns.get('uplink').put(gQuestion);    //link answer to question.

            // console.log("ChatAI gQuestion", gQuestion);  
            // console.log("ChatAI gAns", gAns);

            // //get both question and answer from questin node.
            // gQuestion.get('message').once( msg => {
            //     console.log("ChatAI from question Q=", msg)
            // })
            // gQuestion.get('downlink').once( msg => {
            //     console.log("ChatAI from question A.message=", msg.message)
            //     console.log("ChatAI from question answer soul=", msg._['#'])
            // })
            // // gQuestion.get('_').once( msg => {
            //    console.log("ChatAI from question Question soul=", gQuestion._.get)
            //    console.log("ChatAI from question Question =", gQuestion._.put.message)
            //    console.log("ChatAI from question answer soul =", gQuestion._.put.downlink)
            // // })

            // //get both question and answer from answer node.
            // gAns.get('uplink').once( ques => {
            //     console.log("ChatAI from gAns questione=", ques.message)
            // })
            // gAns.get('message').once( ans => {
            //     console.log("ChatAI from gAns answer=", ans)
            // })
            // console.log("ChatAI from answer answer soul=", gAns._.get)
            // console.log("ChatAI from answer answer =", gAns._.put.message)
            // console.log("ChatAI from answer question soul =", gAns._.put.uplink)
            console.log("ChatAI from gAns", gAns)
            console.log("ChatAI from myself", myself)

            // gAns.path('author').put(myself)
            // myself.path('post').set(gAns);

        })

    }
}
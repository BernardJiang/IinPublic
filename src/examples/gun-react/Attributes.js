import xs from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import sampleCombine from 'xstream/extra/sampleCombine';

import React, { Component }  from 'react'
import Entity from './Entity'
import AttributeList from './AttributeList'

import { div, form, ul, li, h1, input, button, p } from '@cycle/react-dom';

const formatMsgs = msgs => Object.keys(msgs)
  .map(key => ({ ...msgs[key] }))
  .filter(m => Boolean(m.when) && m.key !== '_')
  .sort((a, b) => - a.when + b.when)
  .map(m => ((m.whenFmt = new Date(m.when).toLocaleString().toLowerCase()), m))


  
export class Attributes_old extends Component {
  constructor({entity}) {
    super()
    this.entity = entity;
    this.state = {
      newMsg: '',
      stageName: '', //(document.cookie.match(/alias\=(.*?)(\&|$|\;)/i)||[])[1]||'',
      question: '',
      answer: '',
      options: '',
      msgs: {},
    }
  }
  
  componentDidMount() {
    this.entity && this.entity.onAttributesChange(this.updateUIAttributes)   
  }

  componentWillUnmount() {
    this.entity && this.entity.onAttributesChange(null)   
  }

  updateUIAttributes =  obj => {
    this.setState(obj);
  }

  //Not in use yet.
  // send = e => {
  //   e.preventDefault()
  //   // console.log("dbg", "Calling send!");
    
  //   if(!this.entity.isUserOnline()){ 
  //     console.log("err", "Sign in first!!")
  //     return 
  //   }else{
  //     this.entity.onChatMessage(this.updateUI)   
  //   }
  //   // console.log("dbg", "Calling recall!");

  //   this.entity.user.recall().then( ack=> {
  //     const who = ack.alias;
  //     // console.log(who);      
  //     this.setState({name: who})
  //     // document.cookie = ('alias=' + who)
  //     // console.log("zzz", document.cookie); 
  //     // console.log("zzz", this.state.name); 
  //     const when = Entity.time()
  //     const key = `${when}_${Entity.random()}`
  //     this.entity.saveMessage(key, {
  //       who,
  //       when,
  //       message: this.state.newMsg,
  //     })

  //     this.setState({newMsg: ''})
  //   });

  // }
  handleQuestionChange = (event) => {
    console.log("handleQuestionChange", event);
    this.setState({question: event.target.value});
  }

  handleAnswerChange = (event) => {
    console.log("handleAnswerChange", event);
    this.setState({answer: event.target.value});
  }
  handleOptionsChange = (event) => {
    console.log("handleOptionsChange", event);
    this.setState({options: event.target.value});
  }

  handleChange = (event) => {
    console.log("handleOptionsChange", event);
    this.setState({[event.target.name]: event.target.value});
  }

  handleSubmit = (event) => {
    // console.log("Attributes", 'question: ' + this.state.question);
    // console.log("Attributes", 'answer: ' + this.state.answer);
    // console.log("Attributes", 'options: ' + this.state.options);
    event.preventDefault();
    this.entity.addNewAttribute({ question: this.state.question, answer: this.state.answer, options: this.state.options})
  }

  render() {
    
    const msgs = formatMsgs(this.state.msgs)
    // console.log("attri:", "total attrs=" +Object.keys(this.state.msgs) + " .... msgs = " + Object.keys(msgs))
    //  msgs.forEach(a => {
    //     console.log("Bernard", "msg=" + a.message + '. bot='+ a.bot)
    //     console.log(a.message, a)
    //   })
    return <div>
        Attributes for {this.state.stageName}
        <form onSubmit={this.handleSubmit}>
          <label>
            Type a question that ends with a ?:
            <input type="text" value={this.state.question} name="question" onChange={this.handleChange} />
            Answer and other options in format o1; o2; o3. 
            <input type="text" value={this.state.answer} name="answer" onChange={this.handleChange} />
            <input type="text" value={this.state.options} name="options" onChange={this.handleChange} />
            {/* Options:
            <select value={this.state.value} onChange={this.handleChange}>
            <option value="grapefruit">Grapefruit</option>
            <option value="lime">Lime</option>
            <option value="coconut">Coconut</option>
            <option value="mango">Mango</option>
          </select> */}
          </label>
          <input type="submit" value="Submit" />
      </form>
      <ul>
        {msgs.map(msg =>
          <li key={msg.message}><b> Q: {msg.message} </b> A: { "answer" in msg ? msg.answer : ""}<span className="when">{msg.whenFmt}</span></li>
        )}
      </ul>
    </div>
  }
}

function entityIntent(entity) {

  const useris$ = entity.getSignStatus()
    .startWith({ authenticated: false });

  return { useris$ }
}

function Intent(DOM) {
  const attributeQuestion$ = DOM
    .select('attributequestion')
    .events('input')
    .map(ev => {
      return ev.target.value
    }).startWith("");

  // const attributeAnswer$ = DOM
  //   .select('attributeanswer')
  //   .events('input')
  //   .map(ev => {
  //     return ev.target.value
  //   }).startWith("");

  const newQuestion$ = attributeQuestion$.map(v => {
    return { question: v }
  }).remember();
  
  // const newAnswer$ = attributeAnswer$.map(v => { return { answer: v } }).remember();

  const clickeventsubmit$ = DOM
    .select('btnattrsubmit')
    .events('click')
    .map(ev => {
      return { typeKey: 'btnattributesubmit' }
    }).startWith({ typeKey: 'noclick' });

  const clickevents$ = clickeventsubmit$

  return { clickevents$, newQuestion$}
}

function model(entityEvents, events) {
  const state$ = xs.merge(entityEvents.useris$, events.newQuestion$)
    .fold((acc, x) => { return { ...acc, ...x } }, {})
    .startWith({ attributeList: [], authenticated: false, stageName: '', question: '', answer: '' })
  return state$
}

function view(state$) {
  const vdom$ = state$
    .map( ([state, attributeView]) =>
      div('#divAttributes.hue.page', [
        h1('Attributes for ' + state.stageName), 
        !!state.stageName && form('#inup.sign.pad.center', [
          div('.mid.row.col', [
            h1('question? my own answer/option 1; other option2; other option3; ...'),
            div('.mid.row.col.rowC', [
              input({ sel: 'attributequestion', type: 'text', placeholder: '' }),
              button({ sel: 'btnattrsubmit' }, 'Submit')
            ])
          ]),
          !!attributeView && attributeView,

        ])
      ])
    ); 
  return vdom$
}

function entityTodo(clickevents$, state$) {
  // sink map filtered stream of payloads into function and emit function
  const outgoingEntityEvents$ = clickevents$
    .compose(sampleCombine(state$))
    .map(([click, state]) => {
      if (state.stageName && state.question) {
        if (click.typeKey === 'btnattributesubmit') {
        console.log("submit a new attribute", state.question, state.answer);      
        return {action: 'btnattributesubmit', authenticated: state.authenticated, stageName: state.stageName, question: state.question, answer: state.answer}
        }

      } else {
        // console.log("stagename or password is invalid", state.stageName, state.password);      
      }

    });
  return outgoingEntityEvents$
}

export default function AttributesComp(sources) {
  const { DOM, entity } = sources;
  // console.log('sources.entity', entity)

  const attributeList = AttributeList(sources)

  const entityEvents = entityIntent(entity);
  const events = Intent(DOM);

  const state1$ = model(entityEvents, events)

  const state$ = xs.combine(state1$, attributeList.DOM);

  const vdom$ = view(state$)

  const outgoingEntityEvents$ = entityTodo(events.clickevents$, state1$)

  const sinks = {
    DOM: vdom$,
    value: state$,
    entity: xs.merge(outgoingEntityEvents$, attributeList.entity)
  }
  return sinks;

}

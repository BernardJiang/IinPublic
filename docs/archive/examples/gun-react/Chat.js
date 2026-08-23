import React, {
  Component
} from 'react'
import { Entity } from './Entity'

const formatMsgs = msgs => Object.keys(msgs)
  .map(key => ({key, ...msgs[key]}))
  .filter(m => Boolean(m.when) && m.key !== '_')
  .sort((a, b) => -a.when + b.when)
  .map(m => ((m.whenFmt = new Date(m.when).toLocaleString().toLowerCase()), m))

export default class Chat extends Component {
  constructor({entity}) {
    super()
    this.entity = entity;
    this.state = {
      newMsg: '',
      stageName: '', //document.cookie.match(/alias\=(.*?)(\&|$|\;)/i)||[])[1]||'',
      msgs: {},
    }
  }

  componentDidMount() {
      this.entity && this.entity.onChatMessage(this.updateUIChat)
  }

  updateUIChat = obj => {
    this.setState(obj);
  }

  send = e => {
    e.preventDefault()

    if (!this.state.stageName) {
      console.log("err", "Sign in first!!")
      return
    }

    const when = Entity.time()
    const key = `${when}_${Entity.random()}`
    this.entity.sendMessage(key, {
      stageName: this.state.stageName,
      when,
      message: this.state.newMsg,
    })

    this.setState({newMsg: ''})
  }

  render() {
    const msgs = formatMsgs(this.state.msgs)
    return <div>
      <form onSubmit={this.send}>
      <input value={this.state.stageName} className="stageName" onChange={e => this.setState({ stageName: e.target.value})} />
      <input value={this.state.newMsg} className="message" onChange={e => this.setState({ newMsg: e.target.value})} />
      <button onClick={this.send}>Send</button>
      </form>
      <ul>
        {msgs.map(msg =>
          <li key={msg.key}><b>{msg.stageName}:</b> {msg.message}<span className="when">{msg.whenFmt}</span></li>
        )}
      </ul>
    </div>
  }
}

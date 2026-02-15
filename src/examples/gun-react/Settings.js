import React, { Component }  from 'react'
import styled from 'styled-components'
import ImageLoader from 'react-load-image'
import Entity from './Entity'

const formatMsgs = msgs => Object.keys(msgs)
  .map(key => ({ ...msgs[key] }))
  .filter(m => Boolean(m.when) && m.key !== '_')
  .sort((a, b) => - a.when + b.when)
  .map(m => ((m.whenFmt = new Date(m.when).toLocaleString().toLowerCase()), m))

  const Icon = styled.svg`
  fill: none;
  stroke: white;
  stroke-width: 2px;
`
const CheckboxContainer = styled.div`
  display: inline-block;
  vertical-align: middle;
`

  const HiddenCheckbox = styled.input.attrs({ type: 'checkbox' })`
  // Hide checkbox visually but remain accessible to screen readers.
  // Source: https://polished.js.org/docs/#hidevisually
  border: 0;
  clip: rect(0 0 0 0);
  clippath: inset(50%);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
`
const StyledCheckbox = styled.div`
  display: inline-block;
  width: 16px;
  height: 16px;
  background: ${props => props.checked ? 'salmon' : 'papayawhip'}
  border-radius: 3px;
  transition: all 150ms;
  ${HiddenCheckbox}:focus + & {
    box-shadow: 0 0 0 3px pink;
  };
  ${Icon} {
    visibility: ${props => props.checked ? 'visible' : 'hidden'}
  };
`
// const Checkbox = ({ className, checked, ...props }) => (
//   <CheckboxContainer className={className}>
//     <HiddenCheckbox checked={checked} {...props} />
//     <StyledCheckbox checked={checked} >
//     <Icon viewBox="0 0 24 24">
//         <polyline points="20 6 9 17 4 12" />
//       </Icon>
//     </StyledCheckbox>
//   </CheckboxContainer>
// )

const Checkbox = props => (
  <input type="checkbox" {...props} />
)
 
export default class Settings extends Component {
  constructor({entity}) {
    super()
    this.entity = entity;
    this.userSettings = this.entity.userSettings;
    this.state = {
      newMsg: '',
      stageName: '', 
      msgs: {},
      bSpeaking: false,
    }
  } 
   
  componentDidMount() {
    this.entity && this.entity.onSettingsChange(this.updateUISettings)   
  }

  updateUISettings =  obj => {
    this.setState(obj);
  }
  
  onSubmitForm = async e => {
    e.preventDefault()
  }
  
  handlestageNameChange = e => this.setState({ stageName: e.target.value})

  Preloader = () => {
    return <img src="data:image/svg+xml,%3csvg viewBox='-208.5 21 100 100' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3e%3ccircle cx='-158.5' cy='71' fill='%23F5EEE5' r='50'/%3e%3cdefs%3e%3ccircle cx='-158.5' cy='71' id='a' r='50'/%3e%3c/defs%3e%3cclipPath id='b'%3e%3cuse overflow='visible' xlink:href='%23a'/%3e%3c/clipPath%3e%3cpath clip-path='url(%23b)' d='M-108.5 121v-14s-21.2-4.9-28-6.7c-2.5-.7-7-3.3-7-12V82h-30v6.3c0 8.7-4.5 11.3-7 12-6.8 1.9-28.1 7.3-28.1 6.7v14h100.1z' fill='%23E6C19C'/%3e%3cg clip-path='url(%23b)'%3e%3cdefs%3e%3cpath d='M-108.5 121v-14s-21.2-4.9-28-6.7c-2.5-.7-7-3.3-7-12V82h-30v6.3c0 8.7-4.5 11.3-7 12-6.8 1.9-28.1 7.3-28.1 6.7v14h100.1z' id='c'/%3e%3c/defs%3e%3cclipPath id='d'%3e%3cuse overflow='visible' xlink:href='%23c'/%3e%3c/clipPath%3e%3cpath clip-path='url(%23d)' d='M-158.5 100.1c12.7 0 23-18.6 23-34.4 0-16.2-10.3-24.7-23-24.7s-23 8.5-23 24.7c0 15.8 10.3 34.4 23 34.4z' fill='%23D4B08C'/%3e%3c/g%3e%3cpath d='M-158.5 96c12.7 0 23-16.3 23-31 0-15.1-10.3-23-23-23s-23 7.9-23 23c0 14.7 10.3 31 23 31z' fill='%23F2CEA5'/%3e%3c/svg%3e" />;
  }

  
  handleCheckboxSpeakingChange = event =>{
    this.setState({ bSpeaking: event.target.checked })
    this.entity.changeSettings('bSpeaking', event.target.checked)
  }
  render() {
    // const msgs = formatMsgs(this.state.msgs)
    // if(!this.entity.isUserOnline() ){
    //   return <div>
    //   Log in first for Settings 
    //   </div>;
    // }
    return <div>
          Settings for {this.state.stageName}   

        <label>
          <Checkbox
            checked={this.state.bSpeaking}
            onChange={this.handleCheckboxSpeakingChange}
          />
          <span>Speaking</span>
        </label>

        {/* <label>
          Is going:
          <input
            name="isGoing"
            type="checkbox"
            checked={this.state.isGoing}
            onChange={this.handleInputChange} />
        </label> */}

          <form id="inup" className="sign pad center" onSubmit={this.onSubmitForm}>
				<div className="mid row col">
        stageName: 	<input value={this.state.stageName} className="huet jot sap" type="text" placeholder="alias" onChange={this.handlestageNameChange}/>
				</div>
				<div className="mid row col go">
					<button className="huet sap act symbol" onClick={this.signin} > {this.state.authenticated ? 'Sign Out' : 'Sign In'} </button>
				</div>
				
			</form>
      
      {/* <ImageLoader className="rsc-ts-image"
              src='https://spindriftfresh.com/wp-content/uploads/2017/12/fruit-header-1.jpg'>
          <img />
          <div>Error!</div>
          <this.Preloader />
      </ImageLoader> */}
  
      <ul>
        {/* {msgs.map(msg =>
          <li key={msg.key}><b> Q: {msg.message} </b> A: {msg.answer}<span className="when">{msg.whenFmt}</span></li>
        )} */}
      <li> <b> StageName: A </b> </li>
      <li> <b> Avatar: Avatar </b> </li>

      </ul>
    </div>
  }
}

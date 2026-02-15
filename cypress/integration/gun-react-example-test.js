// import xs from 'xstream'
// import {mount} from 'cypress-cycle-unit-test'
// import App from '../../src/App';
// import { makeDOMDriver } from "@cycle/react-dom";
// import {makeHashHistoryDriver} from '@cycle/history';
// import { makeGunDriver } from '../../src/cyclegun';

const { a } = require("@cycle/react-dom")

describe('Sign up then sign in', function() {
    // beforeEach(() => {
    //     const drivers = {
    //             react: makeDOMDriver(document.getElementById("root")),
    //             history: makeHashHistoryDriver(),
    //             gun: makeGunDriver({root: 'root', peers: ['http://localhost:8765/gun']})
    //     }
    //     mount(App, drivers)
    //   })

    let waittime = 1000

    function addUser(username, userpassword) {
      cy.get('.stageNameInput')
        .clear()
        .type(username).wait(2000)
        .should('have.value', username)

      cy.get('.passwordInput')
        .clear()
        .type(userpassword).wait(2000)
        .should('have.value', userpassword)

      cy.get('#inup > :nth-child(3) > :nth-child(1)')
        .click()
      
      cy.wait(waittime)

      cy.get('.stageNameInput')
        .clear()
        .type(username).wait(2000)
        .should('have.value', username)

      cy.get('.passwordInput')
        .clear()
        .type(userpassword).wait(2000)
        .should('have.value', userpassword)

      cy.get('#inup > :nth-child(3) > :nth-child(3)')
        .click()

      cy.get('#inup > :nth-child(3) > :nth-child(1)')
        .should('contain','Sign In')
        .click().wait(4000)
        .should('contain','Sign Out')
        cy.wait(500)

        cy.get('#inup > :nth-child(3) > :nth-child(1)')
        .should('contain','Sign Out')
        .click()
        .should('contain','Sign In')
        cy.wait(500)

    }

    function buggyreboot(username, userpassword) {
      cy.get('#inup > :nth-child(1) > :nth-child(2)')
        .clear()
        .type(username)
        .should('have.value', username)

      cy.get('#inup > :nth-child(2) > :nth-child(2)')
        .clear()
        .type(userpassword)
        .should('have.value', userpassword)

      cy.get('#inup > :nth-child(3) > :nth-child(1)')
        // .should('contain','Sign Out')
        .click().wait(2000)
    }

    function signInUser(username, userpassword) {
      cy.get('#inup > :nth-child(1) > :nth-child(2)')
        .clear()
        .type(username)
        .should('have.value', username)

      cy.get('#inup > :nth-child(2) > :nth-child(2)')
        .clear()
        .type(userpassword)
        .should('have.value', userpassword)

      cy.get('#inup > :nth-child(3) > :nth-child(1)')
        .click().wait(waittime)

      cy.get('#inup > :nth-child(3) > :nth-child(1)').then($button => {
          if($button.text().includes('Sign In')){
            cy.get('#inup > :nth-child(3) > :nth-child(1)')
            .click().wait(waittime)
            .should('contain','Sign Out')

          }
        })  
    }

    function signOutUser(username, userpassword) {
      cy.get('#inup > :nth-child(3) > :nth-child(1)')
        .should('contain','Sign Out')
        .click()
        .should('contain','Sign In')

    }

    function add1Attribute(attr) {
      cy.get('#inup > :nth-child(1) > :nth-child(2) > :nth-child(1)')  //input 
      .clear()
      .type(attr)
      .should('have.value', attr)

      .get('#inup > :nth-child(1) > :nth-child(2) > :nth-child(2)')  //submit button
      .click().wait(waittime)

    }

    function delete1stAttribute() {
      cy.get('#inup > :nth-child(2) > :nth-child(1) > :nth-child(1) > :nth-child(1) > :nth-child(1) > :nth-child(1)')  //delete button
      .click().wait(waittime)

    }

    it('Visits local host', function() {
      cy.visit('http://localhost:3000')
      
      .get('#Settings').click().wait(waittime)
      .get('#divSettings').should('be.visible')
      
      .get('#Attributes').click().wait(waittime)
      .get('#divAttributes').should('be.visible')
      .get('#Talks').click().wait(waittime)
      .get('#divTalks').should('be.visible')
      .get('#Chatbot').click().wait(waittime)
      .get('#divChatbot').should('be.visible')
      .get('#Greeter').click().wait(waittime)
      .get('#divGreeter').should('be.visible')

      .get('#signin').click().wait(waittime)
      .get('#divSign').should('be.visible')

      buggyreboot('a', 'a')

      signInUser('a', 'a')
      signOutUser('a', 'a')
      signInUser('b', 'b')
      signOutUser('b', 'b')
    //   cy.get('.rsc-input').clear().type('Q1?').should('have.value', 'Q1?')

      signInUser('a', 'a')

      cy.get('#Attributes').click().wait(waittime)
      .get('#divAttributes').should('be.visible')

      add1Attribute('Your name?a.')
      add1Attribute('q1?')
      add1Attribute('q2?a2.')
      add1Attribute('q3?a3;a31.')
      add1Attribute('q4?a4;a41;a42.')
      delete1stAttribute()
      delete1stAttribute()
      delete1stAttribute()
      delete1stAttribute()

      cy.get('#signin').click().wait(waittime)
      .get('#divSign').should('be.visible')
      signOutUser('a', 'a')

    })

    // it.only('Ask a question, then answer it', function() {
    //   cy.visit('http://localhost:3000')
    // //   signInUser('a', 'a')
    // //   cy.get('.rsc-input')
    // //     .clear()
    // //     .type('Q1?')
    // //     .should('have.value', 'Q1?')
    // //     .type('{enter}')
    // //     .should('have.value', '')

    // })


  })
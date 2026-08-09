////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

//    STATIC FIRE MONITOR
//    VelR - Rocketry Club IIT Tirupati

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <Wire.h>


#define SD_CS_Pin         53

#define SD_WRITE_BUFFER_SIZE  256

#define SD_Flush_Interval    1000  // Flush SD card buffer every 1000 ms

#define Indicator_LED_Anode  36
#define Indicator_LED_Blue   42
#define Indicator_LED_Green  40
#define Indicator_LED_Red    38
#define Buzzer_Pin          35
#define BUZZER_ON           true

#define Pyro_1_Pin          22  
#define Pyro_2_Pin          23  

#define Pyro_1_Continuity   A15 //A14 updated pcb
#define Pyro_2_Continuity   A14 //A15 updated pcb

#define Continuity_Threshold_Voltage  10.0   // Voltage above which continuity is confirmed
#define Continuity_Threshold   Continuity_Threshold_Voltage*1023/(5*3) //% by 3 voltage divider 

#define Loadcell_Amp_Clk  12
#define Loadcell_Amp_Data 13

#define Temp_Amp_Clk   A7
#define Temp_Amp_Data  A6

#define BOARD_TEMP_SENSOR 3 // Index of MAX31855 to use for ambient temp (T11)


const int Temp_Amp_CS[6] = {A8,A9,A10,A11,A12,A13};
const int Temp_Analog[4] = {A0,A1,A2,A5};  

enum System_State 
{
  SYSTEM_SAFE,
  SYSTEM_IDLE,
  SYSTEM_ARMED,
  SYSTEM_IGNITION,
  SYSTEM_POST_IGNITION
};
enum Pyro_Modes
{
 PYRO_1,
 PYRO_2,
 PYRO_BOTH
};

System_State STATE = SYSTEM_SAFE;

Pyro_Modes Pyro_Mode = PYRO_2;



float continuity_voltage_1 = 0.0;   
float continuity_voltage_2 = 0.0;

// --- Ring Buffer Settings ---
const int BUFFER_SIZE = 256; // Must be power of 2

struct LogData {
  unsigned long timestamp;
  uint32_t raw_thrust;
};

volatile LogData ringBuffer[BUFFER_SIZE];
volatile uint8_t bufHead = 0;
volatile uint8_t bufTail = 0;


int16_t Temperatures[10] ={};
int16_t Board_Temp = 0;
uint32_t Pressure = 0;
volatile uint32_t Thrust_Raw = 0;
int32_t last_raw_thrust_for_cal = 0; // Safe copy for calibration
int32_t Thrust_Offset = 142539;
float Thrust_Scale_Factor = 0.13;
float Thrust = 0.0;     

File DataFile;
bool is_logging = false;
unsigned long ignition_start_time = 0;
const unsigned long IGNITION_DURATION = 5000; // 5 seconds



void setup() 
{
  Serial.begin(115200);   // usb comms
  Serial3.begin(115200);  // Wifi comms

  Serial.setTimeout(10);  // Non-blocking read
  Serial3.setTimeout(10);

  pinMode(Indicator_LED_Anode, OUTPUT);
  pinMode(Indicator_LED_Blue, OUTPUT);
  pinMode(Indicator_LED_Green, OUTPUT);
  pinMode(Indicator_LED_Red, OUTPUT);
  pinMode(Buzzer_Pin, OUTPUT);
  
  /* quick test
  digitalWrite(Buzzer_Pin, HIGH);
  digitalWrite(Indicator_LED_Blue , HIGH);
  digitalWrite(Indicator_LED_Green, HIGH);
  digitalWrite(Indicator_LED_Red  , HIGH);
  delay(500);
  digitalWrite(Buzzer_Pin, LOW);
  digitalWrite(Indicator_LED_Blue , HIGH);
  digitalWrite(Indicator_LED_Green, HIGH);
  digitalWrite(Indicator_LED_Red  , HIGH);
  */


  pinMode(Pyro_1_Pin, OUTPUT);
  pinMode(Pyro_2_Pin, OUTPUT);  

  pinMode(Pyro_1_Continuity, INPUT);
  pinMode(Pyro_2_Continuity, INPUT);

  pinMode(Loadcell_Amp_Data, INPUT);
  pinMode(Loadcell_Amp_Clk, OUTPUT);

  pinMode(Temp_Amp_Clk, OUTPUT);
  pinMode(Temp_Amp_Data, INPUT);
  for(int i=0; i<6; i++) {
    pinMode(Temp_Amp_CS[i], OUTPUT);
    digitalWrite(Temp_Amp_CS[i], HIGH);
  }

  digitalWrite(Indicator_LED_Anode,  HIGH);
  digitalWrite(Indicator_LED_Blue,   HIGH);
  digitalWrite(Indicator_LED_Green,  HIGH);
  digitalWrite(Indicator_LED_Red,    HIGH);
  digitalWrite(Buzzer_Pin, LOW);

  digitalWrite(Pyro_1_Pin, HIGH);        // control is active LOW !!!
  digitalWrite(Pyro_2_Pin, HIGH);       // control is active LOW !!!

  // Enable Pin Change Interrupt for Pin 13 (PB7 / PCINT7)  ----> Loadcell Amp Data Pin
 
  PCICR |= (1 << PCIE0);    // Enable PCINT0 group (Port B)
  PCMSK0 |= (1 << PCINT7);  // Enable interrupt for Pin 13 specifically
  
  Serial.println("Motor Test Monitor Initialized");
  Serial3.println("Motor Test Monitor Initialized");

  // Initialize SD Card
  while (!SD.begin(SD_CS_Pin)) {
    Serial.println("SD Card Init Failed! Retrying...");
    Serial3.println("SD Card Init Failed! Retrying...");
    delay(5000);
  }

  Serial.println("SD Card Initialized");
  Serial3.println("SD Card Initialized");
}


void Indicate_State();
void Readtemperatures();
void Initiate_Pyro();
void Stop_Pyro();
void ProcessCommand(Stream &s);


// Interrupt Service Routine for PCINT0 (Port B)   -----> Read Loadcell Data 
ISR(PCINT0_vect) 
{
  // Global interrupts are automatically disabled inside an ISR.
  if (digitalRead(Loadcell_Amp_Data) == LOW) 
  {
    Thrust_Raw = 0;
    for(int i =0; i<24;i++)
    {
      digitalWrite(Loadcell_Amp_Clk,HIGH);
      Thrust_Raw = (Thrust_Raw<<1) + digitalRead(Loadcell_Amp_Data);
      digitalWrite(Loadcell_Amp_Clk,LOW);
    }
    digitalWrite(Loadcell_Amp_Clk,HIGH);
    digitalWrite(Loadcell_Amp_Clk,LOW);  //25th pulse

    // Push to Ring Buffer
    if(Thrust_Raw & 0x00800000) {
      Thrust_Raw |= 0xFF000000;
    }
    uint8_t nextHead = (bufHead + 1) % BUFFER_SIZE;
    if (nextHead != bufTail) {
        ringBuffer[bufHead].timestamp = micros();
        ringBuffer[bufHead].raw_thrust = Thrust_Raw;
        bufHead = nextHead;
    }

    // Clear the interrupt flag to prevent re-triggering from pin toggling during read
    PCIFR = (1 << PCIF0);
  }
}

void loop() 
{
  // 1. Read Temperatures (10Hz)
  static unsigned long lastTempRead = 0;
  if (millis() - lastTempRead >= 10) {
    lastTempRead = millis();
    Readtemperatures();
  }

  // 2. Process Buffer & Write to SD
  static uint8_t telemetry_decimator = 0;
  while (bufHead != bufTail) 
  {
    LogData data;
    data.timestamp = ringBuffer[bufTail].timestamp;
    data.raw_thrust = ringBuffer[bufTail].raw_thrust;
    bufTail = (bufTail + 1) % BUFFER_SIZE;

    // Sign extension for 24-bit number
    if(data.raw_thrust & 0x00800000) {
      data.raw_thrust |= 0xFF000000;
    }
    last_raw_thrust_for_cal = (int32_t)data.raw_thrust; // Store safe copy
    Thrust = ((int32_t)data.raw_thrust - Thrust_Offset) * Thrust_Scale_Factor;
    
    // --- Telemetry Output Helper ---
    auto printTelemetry = [&](Print &p) {
      p.print(data.timestamp);
      p.print(","); p.print(Thrust);
      p.print(","); p.print(Pressure);
      for(int i=0; i<6; i++) { 
        p.print(","); 
        int16_t val = Temperatures[i];
        uint8_t status = val & 0x03;
        if (status == 0) {
           p.print((val >> 2) * 0.25); 
        } else if (status == 1) {
           p.print("OPEN");
        } else if (status == 2) {
           p.print("Short GND");
        } else if (status == 3) {
           p.print("Short VCC");
        }
      }
      for(int i=6; i<10; i++) { p.print(","); p.print(Temperatures[i] / 10.0); }
      p.print(","); p.print(Board_Temp * 0.0625); // T11 (Internal Temp)
      p.print(","); p.println(STATE);
    };

    // Send to Serial Ports
    if (telemetry_decimator == 0) {
      printTelemetry(Serial);
      printTelemetry(Serial3);
    }
    telemetry_decimator++;
    if (telemetry_decimator >= 8) telemetry_decimator = 0;

    // Write to SD Card if Logging
    static unsigned long last_flush_time = 0;
    if (is_logging && DataFile) {
      printTelemetry(DataFile);
      // Flush every 1 second to ensure data is saved even if power is lost
      if (millis() - last_flush_time > SD_Flush_Interval) {
        DataFile.flush();
        last_flush_time = millis();
      }
    }
  }

  // 3. Process Commands
  ProcessCommand(Serial);
  ProcessCommand(Serial3);

  // 4. Ignition Timer Logic
  if (STATE == SYSTEM_IGNITION)
  {
    // Ensure pyro is active
    Initiate_Pyro(); 
    
    if (millis() - ignition_start_time > IGNITION_DURATION) 
    {
      Stop_Pyro();
      STATE = SYSTEM_POST_IGNITION;
      
      if (is_logging && DataFile) {
        DataFile.print(micros());
        DataFile.println(",CMD,AUTO_CUTOFF");
      }
    }
  }

  Indicate_State();
  
 
 switch (Pyro_Mode)                         // Check continuity based on selected pyro mode 
 {                                          // and switch to IDLE if continuity is confirmed
  case PYRO_1:
  if(analogRead(Pyro_1_Continuity) >  Continuity_Threshold) {
    if(STATE < SYSTEM_IDLE) STATE = SYSTEM_IDLE;
  } else if (STATE == SYSTEM_IDLE || STATE == SYSTEM_ARMED) {
    STATE = SYSTEM_SAFE;
  }
  break;
  case PYRO_2:
  if(analogRead(Pyro_2_Continuity) >  Continuity_Threshold) {
    if(STATE < SYSTEM_IDLE) STATE = SYSTEM_IDLE;
  } else if (STATE == SYSTEM_IDLE || STATE == SYSTEM_ARMED) {
    STATE = SYSTEM_SAFE;
  }
  break;
  case PYRO_BOTH:
  if((analogRead(Pyro_1_Continuity) >  Continuity_Threshold)&&(analogRead(Pyro_2_Continuity) >  Continuity_Threshold)) {
    if(STATE < SYSTEM_IDLE) STATE = SYSTEM_IDLE;
  } else if (STATE == SYSTEM_IDLE || STATE == SYSTEM_ARMED) {
    STATE = SYSTEM_SAFE;
  }
  break;
 default:
  break;
 }


  /*
 STATE = STATE + 1;  // For testing state changes
  delay(5000);  // Delay to visualize state changes
*/

}

void Indicate_State()
{
  static unsigned long last_buzzer_time = 0;

  switch (STATE)
  {
    case SYSTEM_SAFE:
      digitalWrite(Indicator_LED_Blue, HIGH);
      digitalWrite(Indicator_LED_Green, LOW); // GREEN 
      digitalWrite(Indicator_LED_Red, HIGH);
      if (BUZZER_ON) digitalWrite(Buzzer_Pin, LOW);

      break;

    case SYSTEM_IDLE:
      digitalWrite(Indicator_LED_Blue, HIGH);
      digitalWrite(Indicator_LED_Green, LOW); // YELLOW + short buzzer
      digitalWrite(Indicator_LED_Red, LOW);
      

      
      if (millis() - last_buzzer_time > 500) {
        last_buzzer_time = millis();
        if (BUZZER_ON) digitalWrite(Buzzer_Pin, !digitalRead(Buzzer_Pin));
      }
      break;

    case SYSTEM_ARMED:
      digitalWrite(Indicator_LED_Blue, HIGH);
      analogWrite(Indicator_LED_Green, 200);  // ORANGE + steady buzzer
      digitalWrite(Indicator_LED_Red, LOW);
      if (BUZZER_ON) digitalWrite(Buzzer_Pin, HIGH);
      break;

    case SYSTEM_IGNITION:
      // Fast blink RED
      digitalWrite(Indicator_LED_Blue, HIGH);
      digitalWrite(Indicator_LED_Green, HIGH); // RED + buzzer continues
      digitalWrite(Indicator_LED_Red, LOW);
      break;

    case SYSTEM_POST_IGNITION:
      // Slow blink GREEN

      digitalWrite(Indicator_LED_Blue, LOW);
      digitalWrite(Indicator_LED_Red, HIGH);   // BLUE and buzzer off
      digitalWrite(Indicator_LED_Green, HIGH);
      digitalWrite(Buzzer_Pin, LOW);

      break;
  }
}

void Initiate_Pyro()
{
  switch (Pyro_Mode)
  {
    case PYRO_1:
      digitalWrite(Pyro_1_Pin, LOW);   // Activate Pyro 1
      break;  
    case PYRO_2:
      digitalWrite(Pyro_2_Pin, LOW);   // Activate Pyro 2
      break;
    case PYRO_BOTH:
      digitalWrite(Pyro_1_Pin, LOW);   // Activate Both Pyros
      digitalWrite(Pyro_2_Pin, LOW);
      break;
  }
}

void Stop_Pyro()
{
  switch (Pyro_Mode)
  {
    case PYRO_1:
      digitalWrite(Pyro_1_Pin, HIGH);   // Deactivate Pyro 1
      break;  
    case PYRO_2:
      digitalWrite(Pyro_2_Pin, HIGH);   // Deactivate Pyro 2
      break;
    case PYRO_BOTH:
      digitalWrite(Pyro_1_Pin, HIGH);   // Deactivate Both Pyros
      digitalWrite(Pyro_2_Pin, HIGH);
      break;
  }
}

void Readtemperatures()
{
  uint32_t data;
  for(int sensor =0;sensor<6;sensor++)
  {
    data = 0;
    digitalWrite(Temp_Amp_CS[sensor],LOW);
    delayMicroseconds(1); // Allow CS to settle
  
    for(int i = 0;i<32;i++)
    {
      digitalWrite(Temp_Amp_Clk,HIGH);
      delayMicroseconds(1); // Ensure Clock High duration
      data = data<<1;
      data = data+digitalRead(Temp_Amp_Data);
      digitalWrite(Temp_Amp_Clk,LOW);
      delayMicroseconds(1); // Ensure Clock Low duration

    }
    
    if (sensor == BOARD_TEMP_SENSOR) {
      int16_t internal = (data >> 4) & 0xFFF;
      if (internal & 0x800) internal |= 0xF000; // Sign extend 12-bit to 16-bit
      Board_Temp = internal;
    }

    digitalWrite(Temp_Amp_CS[sensor],HIGH);
    uint32_t temp = data & 0x00000007; // status bits
    
    // Strictly map 3-bit status to 2-bit code to protect temperature data at bit 2
    if (temp & 0x04) {
      temp = 3; // Short to VCC (Bit 2 set) -> 11
    } else if (temp & 0x02) {
      temp = 2; // Short to GND (Bit 1 set) -> 10
    } else if (temp & 0x01) {
      temp = 1; // Open Circuit (Bit 0 set) -> 01
    }
    
    Temperatures[sensor] = ((data>>18)<<2) | temp; // 14 bit temp data + 2 bit status
  }
    
  for(int i=0;i<4;i++)
  { 
    // Discharge the ADC capacitor to 0V before reading the actual pin.
    // This breaks the "wrap-around" ghosting chain for disconnected sensors.
    analogRead(A3);
    analogRead(Temp_Analog[i]); 
    delayMicroseconds(10);      
    Temperatures[i+6] = (int16_t)((analogRead(Temp_Analog[i]) * 5000UL) / 1023); // * 0.1 deg C
  }

}

void ProcessCommand(Stream &s) 
{
  if (s.available()) {
    String input = s.readStringUntil('\n');
    input.trim();
    unsigned long cmdTime = micros();

    // Log command if logging enabled
    if (is_logging && DataFile) 
    {
      DataFile.print(cmdTime);
      DataFile.print(",CMD,");
      DataFile.println(input);
    }

    if (input == "ARM") 
    {
      // Only allow ARM from IDLE 
      if (STATE == SYSTEM_IDLE ) 
      {
        // Start Logging
        if (!is_logging) 
        {
          DataFile = SD.open("datalog.csv", FILE_WRITE);
          if (DataFile) 
          {
            is_logging = true;
            STATE = SYSTEM_ARMED;
            // Only write header if file is empty (append mode)
            if (DataFile.size() == 0) {
              DataFile.println("Time(us),Thrust(N),Pressure,T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,T11,State");
            }
            DataFile.print(cmdTime); DataFile.println(",CMD,ARM");
            s.println("ACK");
          } else {
            s.println("FAULT: SD OPEN FAILED");
            STATE = SYSTEM_SAFE;
          }
        } else {
          STATE = SYSTEM_ARMED;
          s.println("ACK");
        }
      }
    }
    else if (input == "DAR") {
      STATE = SYSTEM_IDLE;
      Stop_Pyro(); // Safety measure
      s.println("ACK");
    }
    else if (input == "RST") {
      if (STATE == SYSTEM_POST_IGNITION) {
        STATE = SYSTEM_SAFE;
        s.println("ACK");
      }
    }
    else if (input == "FIR")
    {

      if (STATE == SYSTEM_ARMED) {
        STATE = SYSTEM_IGNITION;
        ignition_start_time = millis();
        Initiate_Pyro();
        s.println("ACK");
      }
    }
    
    else if (input == "SLG") {
      if (is_logging && DataFile) {
        DataFile.print(cmdTime); DataFile.println(",CMD,SLG");
        DataFile.close();
        is_logging = false;
        s.println("ACK");
      }
    }
    else if (input.startsWith("CAL")) 
    {
      // Parse integer argument
      int val = input.substring(3).toInt();
      
      if (val == 0) {
        Thrust_Offset = last_raw_thrust_for_cal;
        s.print("Offset set to: ");
        s.println(Thrust_Offset);
        s.println("ACK");
      } 
      else 
      {
        // Avoid divide by zero
        if (last_raw_thrust_for_cal != Thrust_Offset) 
        {
          Thrust_Scale_Factor = (float)val / (float)(last_raw_thrust_for_cal - Thrust_Offset);
          s.print("Scale set to: ");
          s.println(Thrust_Scale_Factor);
          s.println("ACK");
        }
       }
     }
        else if (input.startsWith("TIM")) 
    {
       DataFile.print("Time Stamp:"); 
       DataFile.println(input.substring(3));
      s.println("Time Stamp:");
      s.println(input.substring(3));
      s.println("ACK");
        
    }
  }
}